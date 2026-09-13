import path from 'node:path';
import { formatHashlineHeader } from './format';
import { HASHLINE_GREP_GUIDELINES, withGuidelines } from './prompts';
import type { InMemorySnapshotStore } from './snapshots';

const HIT = /^(.+?):(\d+)(?::\d+)?:/;
const MATCH_SUFFIX = /^:\d+(?::\d+)?:/;
const CONTEXT_SUFFIX = /^-\d+-/;

type GrepParams = { path?: unknown };

function pathApi(...values: string[]): typeof path.posix {
  return values.some((value) => /^[A-Za-z]:[\\/]/.test(value) || value.includes('\\'))
    ? path.win32
    : path.posix;
}

function isAbsolute(filePath: string): boolean {
  return path.posix.isAbsolute(filePath) || path.win32.isAbsolute(filePath);
}

function extractHitPaths(text: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const line of text.split('\n')) {
    const match = HIT.exec(line);
    if (!match) continue;
    const filePath = match[1]!;
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    paths.push(filePath);
  }
  return paths;
}

function resultText(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return undefined;
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') return undefined;
  return first.text;
}

async function resolveHit(
  outputPath: string,
  params: unknown,
  readFileText: (path: string) => Promise<string | undefined>
): Promise<{ path: string; body: string } | undefined> {
  if (isAbsolute(outputPath)) {
    const body = await readFileText(outputPath);
    return body === undefined ? undefined : { path: outputPath, body };
  }
  const searchPath =
    params && typeof params === 'object' && typeof (params as GrepParams).path === 'string'
      ? ((params as GrepParams).path as string)
      : undefined;
  if (!searchPath) {
    const body = await readFileText(outputPath);
    return body === undefined ? undefined : { path: outputPath, body };
  }
  const P = pathApi(searchPath, outputPath);
  if (P.basename(P.normalize(searchPath)) === P.normalize(outputPath)) {
    const body = await readFileText(searchPath);
    if (body !== undefined) return { path: searchPath, body };
  }
  const filePath = P.join(searchPath, outputPath);
  const body = await readFileText(filePath);
  return body === undefined ? undefined : { path: filePath, body };
}

function rewriteOutputPaths(
  text: string,
  outputPaths: readonly string[],
  resolved: ReadonlyMap<string, string>
): string {
  const paths = [...outputPaths].sort((a, b) => b.length - a.length);
  return text
    .split('\n')
    .map((line) => {
      for (const outputPath of paths) {
        if (!line.startsWith(outputPath)) continue;
        const suffix = line.slice(outputPath.length);
        if (!MATCH_SUFFIX.test(suffix) && !CONTEXT_SUFFIX.test(suffix)) continue;
        const filePath = resolved.get(outputPath);
        return filePath ? `${filePath}${suffix}` : line;
      }
      return line;
    })
    .join('\n');
}

export function withHashlineGrep<T extends { execute: (...args: never[]) => unknown }>(
  definition: T,
  store: InMemorySnapshotStore,
  readFileText: (path: string) => Promise<string | undefined>
): T {
  const execute = definition.execute as (
    toolCallId: string,
    params: unknown,
    ...rest: unknown[]
  ) => unknown;
  return withGuidelines(
    {
      ...definition,
      execute: (async (toolCallId: string, params: unknown, ...rest: unknown[]) => {
        const result = await execute(toolCallId, params, ...rest);
        const text = resultText(result);
        if (text === undefined) return result;
        const trimmed = text.trim();
        if (!trimmed || /^no matches found$/i.test(trimmed)) return result;
        const headers: string[] = [];
        const resolvedPaths = new Map<string, string>();
        const outputPaths = extractHitPaths(text);
        for (const outputPath of outputPaths) {
          const resolved = await resolveHit(outputPath, params, readFileText);
          if (!resolved) continue;
          const tag = store.record(resolved.path, resolved.body);
          headers.push(formatHashlineHeader(resolved.path, tag));
          resolvedPaths.set(outputPath, resolved.path);
        }
        if (headers.length === 0) return result;
        const visibleText = rewriteOutputPaths(text, outputPaths, resolvedPaths);
        return {
          ...(result as object),
          content: [{ type: 'text', text: `${headers.join('\n')}\n${visibleText}` }],
        };
      }) as T['execute'],
    },
    HASHLINE_GREP_GUIDELINES
  );
}
