import type { ApplyPatchChunk, ApplyPatchOperation } from './types';

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const ADD = '*** Add File: ';
const DELETE = '*** Delete File: ';
const UPDATE = '*** Update File: ';
const MOVE = '*** Move to: ';
const EOF = '*** End of File';
const ENVIRONMENT_ID = '*** Environment ID:';
const CHANGE_CONTEXT = '@@ ';
const EMPTY_CHANGE_CONTEXT = '@@';
const HUNK_HEADERS = "'*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'";
const BEGIN_DECORATED = `${BEGIN} ***`;
const END_DECORATED = `${END} ***`;
const PATCH_OPERATION = /^\*\*\* (?:Add|Update|Delete) File: .+$/;

export function looksLikeApplyPatchDocument(value: string): boolean {
  const lines = rustLines(value.trim());
  if (lines.length < 3) return false;
  const first = lines[0].trim();
  const last = lines.at(-1)?.trim();
  if ((first !== BEGIN && first !== BEGIN_DECORATED) || (last !== END && last !== END_DECORATED)) {
    return false;
  }
  return lines.slice(1, -1).some((line) => PATCH_OPERATION.test(line));
}

function rustLines(value: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\n') continue;
    const end = index > 0 && value[index - 1] === '\r' ? index - 1 : index;
    lines.push(value.slice(start, end));
    start = index + 1;
  }
  if (start < value.length) lines.push(value.slice(start));
  return lines;
}

function invalidPatch(message: string): never {
  throw new Error(`invalid patch: ${message}`);
}

function invalidHunk(lineNumber: number, message: string): never {
  throw new Error(`invalid hunk at line ${lineNumber}, ${message}`);
}

function repairEnvelopeLines(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const first = lines[0].trim();
  const last = lines.at(-1)?.trim();
  const beginOk = first === BEGIN || first === BEGIN_DECORATED;
  const endOk = last === END || last === END_DECORATED;
  if (!beginOk || !endOk || (first === BEGIN && last === END)) return lines;
  const body = lines.slice(1, -1);
  if (!body.some((line) => PATCH_OPERATION.test(line))) return lines;
  return [BEGIN, ...body, END];
}

function checkBoundaries(lines: string[]): string[] {
  const first = lines[0]?.trim();
  const last = lines.at(-1)?.trim();
  if (first === BEGIN && last === END) return lines;
  if (first !== BEGIN) {
    invalidPatch("The first line of the patch must be '*** Begin Patch'");
  }
  invalidPatch("The last line of the patch must be '*** End Patch'");
}

function stripHeredoc(lines: string[]): string[] {
  try {
    return checkBoundaries(repairEnvelopeLines(lines));
  } catch (error) {
    const first = lines[0];
    const last = lines.at(-1);
    if (
      lines.length >= 4 &&
      last?.endsWith('EOF') &&
      (first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"')
    ) {
      return checkBoundaries(repairEnvelopeLines(lines.slice(1, -1)));
    }
    throw error;
  }
}

type Mode = 'notStarted' | 'started' | 'add' | 'delete' | 'update' | 'ended';

function lastUpdate(
  operations: ApplyPatchOperation[]
): Extract<ApplyPatchOperation, { type: 'update' }> | undefined {
  const last = operations.at(-1);
  return last?.type === 'update' ? last : undefined;
}

function lastChunk(
  operation: Extract<ApplyPatchOperation, { type: 'update' }> | undefined
): ApplyPatchChunk | undefined {
  return operation?.chunks.at(-1);
}

function chunkEmpty(chunk: ApplyPatchChunk | undefined): boolean {
  return chunk !== undefined && chunk.oldLines.length === 0 && chunk.newLines.length === 0;
}

function ensureUpdateNotEmpty(
  operations: ApplyPatchOperation[],
  mode: Mode,
  hunkLineNumber: number,
  line: string,
  lineNumber: number
): void {
  const update = lastUpdate(operations);
  if (!update) return;
  if (update.chunks.length === 0 && mode === 'update') {
    invalidHunk(hunkLineNumber, `Update file hunk for path '${update.path}' is empty`);
  }
  if (!chunkEmpty(lastChunk(update))) return;
  if (line === END) invalidHunk(lineNumber, 'Update hunk does not contain any lines');
  invalidHunk(
    lineNumber,
    `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`
  );
}

function pushContext(chunk: ApplyPatchChunk, line: string): void {
  chunk.contextLineIndices.push([chunk.oldLines.length, chunk.newLines.length]);
  chunk.oldLines.push(line);
  chunk.newLines.push(line);
}

function ensureChunk(update: Extract<ApplyPatchOperation, { type: 'update' }>): ApplyPatchChunk {
  const last = lastChunk(update);
  if (last) return last;
  const chunk: ApplyPatchChunk = {
    oldLines: [],
    newLines: [],
    contextLineIndices: [],
    endOfFile: false,
  };
  update.chunks.push(chunk);
  return chunk;
}

function handleHeader(
  trimmed: string,
  operations: ApplyPatchOperation[],
  mode: Mode,
  hunkLineNumber: number,
  lineNumber: number,
  environmentId: { value?: string }
): Mode | undefined {
  if (mode === 'started' && trimmed.startsWith(ENVIRONMENT_ID)) {
    if (environmentId.value !== undefined) {
      invalidPatch('apply_patch environment_id cannot be specified more than once');
    }
    const value = trimmed.slice(ENVIRONMENT_ID.length).trim();
    if (!value) invalidPatch('apply_patch environment_id cannot be empty');
    environmentId.value = value;
    return mode;
  }
  if (trimmed === END) {
    ensureUpdateNotEmpty(operations, mode, hunkLineNumber, trimmed, lineNumber);
    return 'ended';
  }
  if (trimmed.startsWith(ADD)) {
    ensureUpdateNotEmpty(operations, mode, hunkLineNumber, trimmed, lineNumber);
    operations.push({ type: 'add', path: trimmed.slice(ADD.length), content: '' });
    return 'add';
  }
  if (trimmed.startsWith(DELETE)) {
    ensureUpdateNotEmpty(operations, mode, hunkLineNumber, trimmed, lineNumber);
    operations.push({ type: 'delete', path: trimmed.slice(DELETE.length) });
    return 'delete';
  }
  if (trimmed.startsWith(UPDATE)) {
    ensureUpdateNotEmpty(operations, mode, hunkLineNumber, trimmed, lineNumber);
    operations.push({ type: 'update', path: trimmed.slice(UPDATE.length), chunks: [] });
    return 'update';
  }
  return undefined;
}

function invalidHeader(lineNumber: number, trimmed: string): never {
  invalidHunk(
    lineNumber,
    `'${trimmed}' is not a valid hunk header. Valid hunk headers: ${HUNK_HEADERS}`
  );
}

function processLine(
  line: string,
  operations: ApplyPatchOperation[],
  mode: Mode,
  hunkLineNumber: number,
  lineNumber: number,
  environmentId: { value?: string }
): { mode: Mode; hunkLineNumber: number } {
  const trimmed = line.trim();
  if (mode === 'notStarted') {
    if (trimmed === BEGIN) return { mode: 'started', hunkLineNumber };
    invalidPatch("The first line of the patch must be '*** Begin Patch'");
  }
  if (mode === 'started') {
    const next = handleHeader(trimmed, operations, mode, hunkLineNumber, lineNumber, environmentId);
    if (next)
      return { mode: next, hunkLineNumber: next === 'update' ? lineNumber : hunkLineNumber };
    invalidHeader(lineNumber, trimmed);
  }
  if (mode === 'add') {
    const next = handleHeader(trimmed, operations, mode, hunkLineNumber, lineNumber, environmentId);
    if (next)
      return { mode: next, hunkLineNumber: next === 'update' ? lineNumber : hunkLineNumber };
    if (line.startsWith('+')) {
      const add = operations.at(-1);
      if (add?.type === 'add') add.content += `${line.slice(1)}\n`;
      return { mode, hunkLineNumber };
    }
    invalidHeader(lineNumber, trimmed);
  }
  if (mode === 'delete') {
    const next = handleHeader(trimmed, operations, mode, hunkLineNumber, lineNumber, environmentId);
    if (next)
      return { mode: next, hunkLineNumber: next === 'update' ? lineNumber : hunkLineNumber };
    invalidHeader(lineNumber, trimmed);
  }
  if (mode === 'update') {
    const updateLine = line.trimEnd();
    const next = handleHeader(
      updateLine,
      operations,
      mode,
      hunkLineNumber,
      lineNumber,
      environmentId
    );
    if (next)
      return { mode: next, hunkLineNumber: next === 'update' ? lineNumber : hunkLineNumber };
    const update = lastUpdate(operations);
    if (!update) invalidHeader(lineNumber, trimmed);
    const current = lastChunk(update);
    if (current?.endOfFile) {
      if (updateLine.length === 0) return { mode, hunkLineNumber };
      if (updateLine !== EMPTY_CHANGE_CONTEXT && !updateLine.startsWith(CHANGE_CONTEXT)) {
        invalidHunk(
          lineNumber,
          `Expected update hunk to start with a @@ context marker, got: '${line}'`
        );
      }
    }
    if (
      update.chunks.length === 0 &&
      update.movePath === undefined &&
      updateLine.startsWith(MOVE)
    ) {
      update.movePath = updateLine.slice(MOVE.length);
      return { mode, hunkLineNumber };
    }
    if (
      (updateLine === EMPTY_CHANGE_CONTEXT || updateLine.startsWith(CHANGE_CONTEXT)) &&
      chunkEmpty(current)
    ) {
      invalidHunk(
        lineNumber,
        `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`
      );
    }
    if (updateLine === EMPTY_CHANGE_CONTEXT) {
      update.chunks.push({
        oldLines: [],
        newLines: [],
        contextLineIndices: [],
        endOfFile: false,
      });
      return { mode, hunkLineNumber };
    }
    if (updateLine.startsWith(CHANGE_CONTEXT)) {
      update.chunks.push({
        changeContext: updateLine.slice(CHANGE_CONTEXT.length),
        oldLines: [],
        newLines: [],
        contextLineIndices: [],
        endOfFile: false,
      });
      return { mode, hunkLineNumber };
    }
    if (updateLine === EOF) {
      if (chunkEmpty(current)) invalidHunk(lineNumber, 'Update hunk does not contain any lines');
      if (current) current.endOfFile = true;
      return { mode, hunkLineNumber };
    }
    if (line.length === 0) {
      pushContext(ensureChunk(update), '');
      return { mode, hunkLineNumber };
    }
    if (line.startsWith(' ')) {
      pushContext(ensureChunk(update), line.slice(1));
      return { mode, hunkLineNumber };
    }
    if (line.startsWith('+')) {
      ensureChunk(update).newLines.push(line.slice(1));
      return { mode, hunkLineNumber };
    }
    if (line.startsWith('-')) {
      ensureChunk(update).oldLines.push(line.slice(1));
      return { mode, hunkLineNumber };
    }
    if (current && (current.oldLines.length > 0 || current.newLines.length > 0)) {
      invalidHunk(
        lineNumber,
        `Expected update hunk to start with a @@ context marker, got: '${line}'`
      );
    }
    invalidHunk(
      lineNumber,
      `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`
    );
  }
  if (mode === 'ended') {
    if (trimmed.length === 0) return { mode, hunkLineNumber };
    invalidPatch("The last line of the patch must be '*** End Patch'");
  }
  invalidPatch("The last line of the patch must be '*** End Patch'");
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
  const patchLines = stripHeredoc(rustLines(input.trim()));
  const operations: ApplyPatchOperation[] = [];
  const environmentId: { value?: string } = {};
  let mode: Mode = 'notStarted';
  let hunkLineNumber = 0;
  let lineNumber = 0;
  for (const line of patchLines) {
    lineNumber += 1;
    ({ mode, hunkLineNumber } = processLine(
      line,
      operations,
      mode,
      hunkLineNumber,
      lineNumber,
      environmentId
    ));
  }
  if (mode === 'update') {
    ensureUpdateNotEmpty(operations, mode, hunkLineNumber, END, lineNumber);
  }
  if (mode !== 'ended') invalidPatch("The last line of the patch must be '*** End Patch'");
  return operations;
}

export function getApplyPatchPaths(params: unknown): string[] {
  return parseApplyPatch(requireApplyPatchInput(params)).flatMap((operation) =>
    operation.type === 'update' && operation.movePath
      ? [operation.path, operation.movePath]
      : [operation.path]
  );
}
