import { Buffer } from 'node:buffer';
import {
  type HashlinePutOp,
  parseAndValidateHashlinePuts,
  serializeHashlinePuts,
  validateHashlinePuts,
} from './apply';
import { normalizeFileHashText, splitAddressableLines } from './format';

const CONTEXT_LINES = 3;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_LINES = 50_000;
const MAX_LINE_COMPARISONS = 2_000_000;

export interface HashlineRelocationRange {
  from: { start: number; end: number };
  to: { start: number; end: number };
}

export interface HashlineRelocation {
  patch: string;
  ranges: HashlineRelocationRange[];
}

interface RelocationGroup {
  start: number;
  end: number;
  ops: HashlinePutOp[];
}

interface ComparisonBudget {
  used: number;
}

function relocationError(reason: string): Error {
  return new Error(
    `hashline relocation failed: ${reason}. Read the file again and retry with a fresh tag`
  );
}

function comparisonLines(text: string): string[] {
  const comparable = text.startsWith('\uFEFF') ? text.slice(1) : text;
  return splitAddressableLines(comparable).map((line) => normalizeFileHashText(line));
}

function assertByteBudget(label: string, text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
    throw relocationError(`${label} exceeds the ${MAX_TEXT_BYTES}-byte safety budget`);
  }
}

function assertLineBudget(label: string, lines: readonly string[]): void {
  if (lines.length > MAX_TEXT_LINES) {
    throw relocationError(`${label} exceeds the ${MAX_TEXT_LINES}-line safety budget`);
  }
}

function mergeRelocationGroups(
  ops: readonly HashlinePutOp[],
  lineCount: number
): RelocationGroup[] {
  const groups: RelocationGroup[] = [];
  for (const op of ops) {
    const start = Math.max(1, op.start - CONTEXT_LINES);
    const end = Math.min(lineCount, op.end + CONTEXT_LINES);
    const previous = groups[groups.length - 1];
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
      previous.ops.push(op);
    } else {
      groups.push({ start, end, ops: [op] });
    }
  }
  return groups;
}

function findUniqueWindow(
  lines: readonly string[],
  window: readonly string[],
  budget: ComparisonBudget,
  label: string
): number {
  let found = -1;
  const lastStart = lines.length - window.length;
  for (let start = 0; start <= lastStart; start++) {
    let matches = true;
    for (let offset = 0; offset < window.length; offset++) {
      budget.used += 1;
      if (budget.used > MAX_LINE_COMPARISONS) {
        throw relocationError(`shared comparison budget exhausted while locating ${label} context`);
      }
      if (lines[start + offset] !== window[offset]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    if (found !== -1) throw relocationError(`${label} context is ambiguous`);
    found = start;
  }
  if (found === -1) throw relocationError(`${label} context no longer matches`);
  return found;
}

export function relocateHashlinePatch(
  snapshotText: string,
  liveText: string,
  patch: string
): HashlineRelocation {
  assertByteBudget('snapshot', snapshotText);
  assertByteBudget('live text', liveText);
  const snapshotLines = comparisonLines(snapshotText);
  const liveLines = comparisonLines(liveText);
  assertLineBudget('snapshot', snapshotLines);
  assertLineBudget('live text', liveLines);
  const ops = parseAndValidateHashlinePuts(patch, snapshotLines.length);

  const groups = mergeRelocationGroups(ops, snapshotLines.length);
  const budget: ComparisonBudget = { used: 0 };
  const relocated: HashlinePutOp[] = [];
  const ranges: HashlineRelocationRange[] = [];
  let previousLiveGroupStart = -1;

  for (const group of groups) {
    const window = snapshotLines.slice(group.start - 1, group.end);
    const snapshotStart = findUniqueWindow(snapshotLines, window, budget, 'snapshot');
    const liveStart = findUniqueWindow(liveLines, window, budget, 'live');
    if (liveStart <= previousLiveGroupStart) {
      throw relocationError('matched context groups changed relative order');
    }
    previousLiveGroupStart = liveStart;
    const delta = liveStart - snapshotStart;
    for (const op of group.ops) {
      const next = { ...op, start: op.start + delta, end: op.end + delta };
      relocated.push(next);
      ranges.push({
        from: { start: op.start, end: op.end },
        to: { start: next.start, end: next.end },
      });
    }
  }

  try {
    validateHashlinePuts(relocated, liveLines.length);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw relocationError(`relocated PUT ranges are invalid: ${reason}`);
  }
  return { patch: serializeHashlinePuts(relocated), ranges };
}
