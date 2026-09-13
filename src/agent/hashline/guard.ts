import { computeFileHash } from './format';
import type { InMemorySnapshotStore } from './snapshots';

export function resolveSnapshot(
  store: InMemorySnapshotStore,
  path: string,
  tag: string,
  liveText: string
): { snapshotText: string; fresh: boolean } {
  const snapshotText = store.get(path, tag);
  if (snapshotText === undefined) {
    throw new Error(
      `hashline snapshot missing: ${path}#${tag}. Read ${path} again and retry with the fresh tag`
    );
  }
  return { snapshotText, fresh: computeFileHash(liveText) === tag };
}

export function assertFreshSnapshot(
  store: InMemorySnapshotStore,
  path: string,
  tag: string,
  liveText: string
): void {
  if (!resolveSnapshot(store, path, tag, liveText).fresh) {
    throw new Error(`hashline snapshot stale: ${path}#${tag}`);
  }
}
