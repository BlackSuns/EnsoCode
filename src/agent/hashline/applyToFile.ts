import { applyHashlineToText } from './apply';
import { computeFileHash } from './format';
import { resolveSnapshot } from './guard';
import { applyHashlineInput, parseHashlineHeader } from './patch';
import { type HashlineRelocationRange, relocateHashlinePatch } from './relocate';
import type { InMemorySnapshotStore } from './snapshots';

export async function applyHashlineToFile(options: {
  store: InMemorySnapshotStore;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, text: string) => Promise<void>;
  input: string;
}): Promise<{
  path: string;
  previous: string;
  text: string;
  tag: string;
  relocation?: { ranges: HashlineRelocationRange[] };
}> {
  const header = parseHashlineHeader(options.input);
  if (!header.path || !header.tag) {
    throw new Error('hashline edit requires [path#TAG] header from a prior read');
  }
  const liveText = await options.readText(header.path);
  const { snapshotText, fresh } = resolveSnapshot(options.store, header.path, header.tag, liveText);
  let relocation: ReturnType<typeof relocateHashlinePatch> | undefined;
  let next: string;
  if (fresh) {
    next = applyHashlineInput(liveText, options.input);
  } else {
    relocation = relocateHashlinePatch(snapshotText, liveText, header.body);
    next = applyHashlineToText(liveText, relocation.patch);
  }

  const beforeWrite = await options.readText(header.path);
  if (beforeWrite !== liveText) {
    throw new Error(
      `hashline file changed before write: ${header.path}. Read ${header.path} again and retry with the fresh tag`
    );
  }
  await options.writeText(header.path, next);
  const tag = options.store.record(header.path, next) || computeFileHash(next);
  const result = { path: header.path, previous: liveText, text: next, tag };
  return relocation ? { ...result, relocation: { ranges: relocation.ranges } } : result;
}
