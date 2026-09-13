import { splitAddressableLines } from './format';
import { HASHLINE_PUT_RULE } from './prompts';

export interface HashlinePutOp {
  start: number;
  end: number;
  body: string[];
}

interface EditableLine {
  text: string;
  eol: string;
}

function splitEditableLines(text: string): EditableLine[] {
  const lines = splitAddressableLines(text);
  const eols = Array.from(text.matchAll(/\r\n|\n/g), (match) => match[0]);
  if (!/(?:\r\n|\n)$/.test(text)) eols.push('');
  return lines.map((line, index) => ({ text: line, eol: eols[index] ?? '' }));
}

function replacementEol(lines: readonly EditableLine[], start: number, end: number): string {
  for (let index = start - 1; index < end; index++) {
    const eol = lines[index]?.eol;
    if (eol) return eol;
  }
  for (let index = start - 2; index >= 0; index--) {
    const eol = lines[index]?.eol;
    if (eol) return eol;
  }
  return lines.find((line) => line.eol)?.eol ?? '\n';
}

function parseHashlinePuts(patch: string): HashlinePutOp[] {
  const lines = patch.split(/\r?\n/);
  const ops: HashlinePutOp[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line === '') {
      i += 1;
      continue;
    }
    if (/^PUT \d+\*:/.test(line)) {
      throw new Error(`block locator not supported: ${line}. Only ${HASHLINE_PUT_RULE}`);
    }
    const match = /^PUT (\d+)\.=(\d+):$/.exec(line);
    if (!match) throw new Error(`invalid hashline op: ${line}. Only ${HASHLINE_PUT_RULE}`);
    const start = Number(match[1]);
    const end = Number(match[2]);
    i += 1;
    const body: string[] = [];
    while (i < lines.length && (lines[i] ?? '').startsWith('+')) {
      body.push((lines[i] ?? '').slice(1));
      i += 1;
    }
    ops.push({ start, end, body });
  }
  if (ops.length === 0) throw new Error('hashline patch has no PUT operations');
  return ops;
}

export function validateHashlinePuts(
  ops: readonly HashlinePutOp[],
  sourceLineCount: number
): HashlinePutOp[] {
  const sorted = [...ops].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const op = sorted[i]!;
    if (op.body.length === 0) throw new Error(`PUT ${op.start}.=${op.end}: missing body`);
    if (op.start < 1 || op.end > sourceLineCount || op.start > op.end) {
      throw new Error(`PUT ${op.start}.=${op.end}: out of range`);
    }
    const prev = sorted[i - 1];
    if (prev && prev.end >= op.start) {
      throw new Error(`PUT ${prev.start}.=${prev.end} overlaps PUT ${op.start}.=${op.end}`);
    }
  }
  return sorted;
}

export function parseAndValidateHashlinePuts(
  patch: string,
  sourceLineCount: number
): HashlinePutOp[] {
  return validateHashlinePuts(parseHashlinePuts(patch), sourceLineCount);
}

export function serializeHashlinePuts(ops: readonly HashlinePutOp[]): string {
  return ops
    .map((op) => `PUT ${op.start}.=${op.end}:\n${op.body.map((line) => `+${line}`).join('\n')}`)
    .join('\n');
}

export function applyHashlineToText(original: string, patch: string): string {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const text = bom ? original.slice(1) : original;
  const sourceLines = splitEditableLines(text);
  const ops = parseAndValidateHashlinePuts(patch, sourceLines.length);

  const out: EditableLine[] = [];
  let cursor = 1;
  for (const op of ops) {
    while (cursor < op.start) {
      out.push(sourceLines[cursor - 1]!);
      cursor += 1;
    }
    const replaced = sourceLines.slice(op.start - 1, op.end);
    const generatedEol = replacementEol(sourceLines, op.start, op.end);
    for (let index = 0; index < op.body.length; index++) {
      const isLast = index === op.body.length - 1;
      const matchingEol = replaced[Math.min(index, replaced.length - 1)]?.eol;
      out.push({
        text: op.body[index]!,
        eol: isLast ? (replaced[replaced.length - 1]?.eol ?? '') : matchingEol || generatedEol,
      });
    }
    cursor = op.end + 1;
  }
  while (cursor <= sourceLines.length) {
    out.push(sourceLines[cursor - 1]!);
    cursor += 1;
  }

  const next = bom + out.map((line) => line.text + line.eol).join('');
  if (next === original) throw new Error('hashline patch produced no change');
  return next;
}
