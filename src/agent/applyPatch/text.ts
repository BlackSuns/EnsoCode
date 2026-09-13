import { isUtf8 } from 'node:buffer';
import type { ApplyPatchChunk } from './types';

interface SourceLine {
  text: string;
  ending?: string;
}

export interface MatchBudget {
  remaining: number;
}

interface Replacement {
  index: number;
  count: number;
  lines: string[];
  order: number;
}

function decode(raw: Buffer, path: string): string {
  if (!isUtf8(raw)) throw new Error(`File is not valid UTF-8: ${path}`);
  const value = raw.toString('utf8');
  if (value.includes('\0')) throw new Error(`Binary file cannot be patched: ${path}`);
  return value;
}

function parseSource(
  raw: Buffer,
  path: string
): {
  bom: string;
  lines: SourceLine[];
  preferredEnding: string;
  terminated: boolean;
  text: string;
} {
  const text = decode(raw, path);
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  const lines: SourceLine[] = [];
  let preferredEnding = '\n';
  let sawEnding = false;
  let start = 0;
  for (let cursor = 0; cursor < body.length; cursor += 1) {
    let ending: string | undefined;
    if (body[cursor] === '\r') {
      ending = body[cursor + 1] === '\n' ? '\r\n' : '\r';
    } else if (body[cursor] === '\n') ending = '\n';
    if (!ending) continue;
    if (!sawEnding) {
      preferredEnding = ending;
      sawEnding = true;
    }
    lines.push({ text: body.slice(start, cursor), ending });
    cursor += ending.length - 1;
    start = cursor + 1;
  }
  if (start < body.length) lines.push({ text: body.slice(start) });
  return {
    bom,
    lines,
    preferredEnding,
    terminated: body.length > 0 && start === body.length,
    text,
  };
}

function findUnique(
  lines: readonly string[],
  pattern: readonly string[],
  start: number,
  eof: boolean,
  label: string,
  budget: MatchBudget
): number {
  const normalizers = [(value: string) => value, (value: string) => value.trimEnd()];
  for (const normalize of normalizers) {
    const matches: number[] = [];
    const last = lines.length - pattern.length;
    const first = eof ? Math.max(start, last) : start;
    for (let index = Math.max(0, first); index <= last; index += 1) {
      budget.remaining -= pattern.length;
      if (budget.remaining < 0) throw new Error('apply_patch comparison limit exceeded');
      if (pattern.every((line, offset) => normalize(lines[index + offset]) === normalize(line))) {
        matches.push(index);
      }
      if (eof) break;
    }
    if (matches.length > 1)
      throw new Error(`Ambiguous ${label}: matched ${matches.length} locations`);
    if (matches.length === 1) return matches[0];
  }
  throw new Error(`Failed to find ${label}`);
}

function computeReplacements(
  sourceLines: readonly SourceLine[],
  chunks: readonly ApplyPatchChunk[],
  path: string,
  budget: MatchBudget
): Replacement[] {
  const lines = sourceLines.map((line) => line.text);
  const replacements: Replacement[] = [];
  let modifiedCursor = 0;
  const insertionPoints = new Set<number>();
  let order = 0;
  for (const chunk of chunks) {
    let anchorAfter = 0;
    if (chunk.changeContext !== undefined) {
      anchorAfter =
        findUnique(
          lines,
          [chunk.changeContext],
          0,
          false,
          `context '${chunk.changeContext}' in ${path}`,
          budget
        ) + 1;
    }
    let leadingContext = 0;
    for (const [oldIndex, newIndex] of chunk.contextLineIndices) {
      if (oldIndex !== leadingContext || newIndex !== leadingContext) break;
      leadingContext += 1;
    }
    const searchStart = Math.max(anchorAfter, modifiedCursor - leadingContext);
    const replacementStart = replacements.length;
    if (chunk.oldLines.length === 0) {
      let index: number;
      if (chunk.changeContext !== undefined && chunk.endOfFile) {
        if (anchorAfter !== lines.length) {
          throw new Error(`Context anchor does not reach End of File in ${path}`);
        }
        index = lines.length;
      } else if (chunk.changeContext !== undefined) index = anchorAfter;
      else if (chunk.endOfFile) index = lines.length;
      else if (lines.length === 0) index = 0;
      else throw new Error(`Pure addition in ${path} needs an anchor or End of File`);
      if (index < modifiedCursor || insertionPoints.has(index)) {
        throw new Error(`Overlapping update chunks in ${path}`);
      }
      replacements.push({ index, count: 0, lines: chunk.newLines, order: order++ });
      insertionPoints.add(index);
      modifiedCursor = index;
      continue;
    }
    const found = findUnique(
      lines,
      chunk.oldLines,
      searchStart,
      chunk.endOfFile,
      `expected lines in ${path}`,
      budget
    );
    let oldStart = 0;
    let newStart = 0;
    for (const [oldContext, newContext] of chunk.contextLineIndices) {
      if (oldStart !== oldContext || newStart !== newContext) {
        replacements.push({
          index: found + oldStart,
          count: oldContext - oldStart,
          lines: chunk.newLines.slice(newStart, newContext),
          order: order++,
        });
      }
      oldStart = oldContext + 1;
      newStart = newContext + 1;
    }
    if (oldStart !== chunk.oldLines.length || newStart !== chunk.newLines.length) {
      replacements.push({
        index: found + oldStart,
        count: chunk.oldLines.length - oldStart,
        lines: chunk.newLines.slice(newStart),
        order: order++,
      });
    }
    for (const replacement of replacements.slice(replacementStart)) {
      const overlapsInsertion = [...insertionPoints].some(
        (point) =>
          point === replacement.index ||
          (replacement.count > 0 &&
            point > replacement.index &&
            point < replacement.index + replacement.count)
      );
      if (replacement.index < modifiedCursor || overlapsInsertion) {
        throw new Error(`Overlapping update chunks in ${path}`);
      }
      if (replacement.count === 0) insertionPoints.add(replacement.index);
      modifiedCursor = Math.max(modifiedCursor, replacement.index + replacement.count);
    }
  }
  return replacements.sort((left, right) => left.index - right.index || left.order - right.order);
}

export function applyUpdateChunks(
  raw: Buffer,
  path: string,
  chunks: readonly ApplyPatchChunk[],
  budget: MatchBudget = { remaining: Number.MAX_SAFE_INTEGER }
): Buffer {
  const source = parseSource(raw, path);
  if (chunks.length === 0) return Buffer.from(source.text, 'utf8');
  const replacements = computeReplacements(source.lines, chunks, path, budget);
  const result: SourceLine[] = [];
  let sourceIndex = 0;
  for (const replacement of replacements) {
    if (replacement.index < sourceIndex) throw new Error(`Overlapping update chunks in ${path}`);
    for (let index = sourceIndex; index < replacement.index; index += 1) {
      result.push(source.lines[index]);
    }
    for (const text of replacement.lines) {
      result.push({ text, ending: source.preferredEnding });
    }
    sourceIndex = replacement.index + replacement.count;
  }
  for (let index = sourceIndex; index < source.lines.length; index += 1) {
    result.push(source.lines[index]);
  }
  for (let index = 0; index < result.length; index += 1) {
    if (index < result.length - 1 || source.terminated) {
      result[index].ending ??= source.preferredEnding;
    } else result[index].ending = undefined;
  }
  const body = result.map((line) => `${line.text}${line.ending ?? ''}`).join('');
  return Buffer.from(source.bom + body, 'utf8');
}

export function decodePatchText(raw: Buffer, path: string): string {
  return decode(raw, path);
}
