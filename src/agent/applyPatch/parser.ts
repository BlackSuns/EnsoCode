import type { ApplyPatchChunk, ApplyPatchOperation } from './types';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const ADD = '*** Add File: ';
const DELETE = '*** Delete File: ';
const UPDATE = '*** Update File: ';
const MOVE = '*** Move to: ';
const EOF = '*** End of File';

function isFileMarker(line: string): boolean {
  return line.startsWith(ADD) || line.startsWith(DELETE) || line.startsWith(UPDATE);
}

function changeMarker(line: string | undefined): string | undefined {
  if (line === undefined) return undefined;
  if (/^@@[ \t]*$/.test(line)) return '@@';
  return line.startsWith('@@ ') ? line : undefined;
}

function parsePath(line: string, marker: string, lineNumber: number): string {
  const value = line.slice(marker.length);
  if (!value || value.trim() !== value || value.includes('\0')) {
    throw new Error(`Invalid patch path at line ${lineNumber}`);
  }
  return value;
}

const NOOP_CHUNK =
  "hunk changes nothing. Put the locator on '@@ ...' and the edit in the same hunk.";

function isIdentity(oldLines: readonly string[], newLines: readonly string[]): boolean {
  return (
    oldLines.length === newLines.length && oldLines.every((line, index) => line === newLines[index])
  );
}

function parseChunk(
  lines: string[],
  start: number
): { chunk?: ApplyPatchChunk; locator?: true; next: number } {
  let cursor = start;
  let changeContext: string | undefined;
  const marker = changeMarker(lines[cursor]);
  if (marker === '@@') cursor += 1;
  else if (marker?.startsWith('@@ ')) {
    changeContext = marker.slice(3);
    cursor += 1;
  }

  const oldLines: string[] = [];
  const newLines: string[] = [];
  const contextLineIndices: Array<[number, number]> = [];
  let consumed = false;
  let endOfFile = false;
  while (cursor < lines.length - 1) {
    const line = lines[cursor];
    if (isFileMarker(line) || changeMarker(line) !== undefined) break;
    if (line === EOF) {
      endOfFile = true;
      cursor += 1;
      if (cursor < lines.length - 1 && !isFileMarker(lines[cursor])) {
        throw new Error(`End of File must finish a chunk at line ${cursor}`);
      }
      break;
    }
    const prefix = line[0];
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') {
      throw new Error(`Invalid change line ${cursor + 1}`);
    }
    const content = line.slice(1);
    if (prefix === ' ') {
      contextLineIndices.push([oldLines.length, newLines.length]);
      oldLines.push(content);
      newLines.push(content);
    } else if (prefix === '-') oldLines.push(content);
    else newLines.push(content);
    consumed = true;
    cursor += 1;
  }
  if (!consumed) throw new Error(`Empty update chunk at line ${start + 1}`);
  if (isIdentity(oldLines, newLines)) {
    if (contextLineIndices.length === oldLines.length) return { locator: true, next: cursor };
    throw new Error(`No-op update chunk at line ${start + 1}: ${NOOP_CHUNK}`);
  }
  return {
    chunk: {
      ...(changeContext === undefined ? {} : { changeContext }),
      oldLines,
      newLines,
      contextLineIndices,
      endOfFile,
    },
    next: cursor,
  };
}

export function normalizeApplyPatchArguments(params: unknown): unknown {
  if (typeof params !== 'string') return params;
  const trimmed = params.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(params);
      return typeof parsed === 'string' ? { input: parsed } : parsed;
    } catch {
      // 非法 JSON 仍作为 raw patch 交给严格 parser 报错。
    }
  }
  return { input: params };
}

export function requireApplyPatchInput(params: unknown): string {
  const normalized = normalizeApplyPatchArguments(params);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('apply_patch arguments must be an object with only input');
  }
  const args = normalized as Record<string, unknown>;
  const keys = Object.keys(args);
  if (keys.length !== 1 || keys[0] !== 'input' || typeof args.input !== 'string') {
    throw new Error('apply_patch accepts exactly one string property: input');
  }
  return args.input;
}

export function parseApplyPatch(input: string): ApplyPatchOperation[] {
  const normalized = input.replaceAll('\r\n', '\n');
  if (normalized.includes('\r')) throw new Error('Invalid patch line ending: lone CR');
  const source = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  const lines = source.split('\n');
  if (lines[0] !== BEGIN || lines.at(-1) !== END) {
    throw new Error(`Invalid patch envelope: expected '${BEGIN}' and '${END}'`);
  }
  const operations: ApplyPatchOperation[] = [];
  let cursor = 1;
  while (cursor < lines.length - 1) {
    const line = lines[cursor];
    if (line.startsWith(ADD)) {
      const target = parsePath(line, ADD, cursor + 1);
      cursor += 1;
      const content: string[] = [];
      while (cursor < lines.length - 1 && !isFileMarker(lines[cursor])) {
        if (!lines[cursor].startsWith('+')) {
          throw new Error(`Add file lines must start with '+' at line ${cursor + 1}`);
        }
        content.push(lines[cursor].slice(1));
        cursor += 1;
      }
      operations.push({
        type: 'add',
        path: target,
        content: content.length === 0 ? '' : `${content.join('\n')}\n`,
      });
      continue;
    }
    if (line.startsWith(DELETE)) {
      operations.push({ type: 'delete', path: parsePath(line, DELETE, cursor + 1) });
      cursor += 1;
      continue;
    }
    if (line.startsWith(UPDATE)) {
      const target = parsePath(line, UPDATE, cursor + 1);
      cursor += 1;
      let movePath: string | undefined;
      if (lines[cursor]?.startsWith(MOVE)) {
        movePath = parsePath(lines[cursor], MOVE, cursor + 1);
        cursor += 1;
      }
      const chunks: ApplyPatchChunk[] = [];
      let firstLocatorLine: number | undefined;
      while (cursor < lines.length - 1 && !isFileMarker(lines[cursor])) {
        const hunkStart = cursor;
        const parsed = parseChunk(lines, hunkStart);
        if (parsed.locator) {
          firstLocatorLine ??= hunkStart + 1;
        } else if (parsed.chunk) {
          chunks.push(parsed.chunk);
        }
        cursor = parsed.next;
      }
      if (chunks.length === 0 && !movePath) {
        if (firstLocatorLine !== undefined) {
          throw new Error(`No-op update chunk at line ${firstLocatorLine}: ${NOOP_CHUNK}`);
        }
        throw new Error(`Update file '${target}' is empty`);
      }
      operations.push({
        type: 'update',
        path: target,
        ...(movePath ? { movePath } : {}),
        chunks,
      });
      continue;
    }
    throw new Error(`Invalid patch syntax at line ${cursor + 1}`);
  }
  if (operations.length === 0) throw new Error('Empty patch');
  return operations;
}

export function getApplyPatchPaths(params: unknown): string[] {
  return parseApplyPatch(requireApplyPatchInput(params)).flatMap((operation) =>
    operation.type === 'update' && operation.movePath
      ? [operation.path, operation.movePath]
      : [operation.path]
  );
}
