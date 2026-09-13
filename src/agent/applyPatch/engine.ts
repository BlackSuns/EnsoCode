import type { AppliedFileChange } from '@shared/types/fileChanges';
import { createLocalApplyPatchIo, normalizePatchPath } from './localIo';
import { parseApplyPatch, requireApplyPatchInput } from './parser';
import { applyUpdateChunks, decodePatchText, type MatchBudget } from './text';
import type {
  ApplyPatchDetails,
  ApplyPatchOperation,
  ApplyPatchPlan,
  PatchEntry,
  PatchIo,
} from './types';
import { PatchMutationUncertainError } from './types';

export const APPLY_PATCH_LIMITS = {
  patchBytes: 1024 * 1024,
  files: 100,
  chunks: 1000,
  fileBytes: 4 * 1024 * 1024,
  totalReadBytes: 16 * 1024 * 1024,
  comparisons: 1_000_000,
} as const;

interface ReadyPlan extends ApplyPatchPlan {
  io: PatchIo;
  snapshots: Map<string, PatchEntry>;
  actions: ReadyAction[];
}

interface PhysicalAction {
  path: string;
  type: 'add' | 'update' | 'delete';
  before: Buffer;
  after: Buffer;
  exclusive?: boolean;
}

interface ReadyAction extends PhysicalAction {
  change: AppliedFileChange;
}

let executionTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = executionTail.then(task, task);
  executionTail = next.catch(() => {});
  return next;
}

function normalizeOperations(operations: ApplyPatchOperation[]): ApplyPatchOperation[] {
  return operations.map((operation) => {
    const normalizedPath = normalizePatchPath(operation.path);
    if (operation.type !== 'update') return { ...operation, path: normalizedPath };
    return {
      ...operation,
      path: normalizedPath,
      ...(operation.movePath ? { movePath: normalizePatchPath(operation.movePath) } : {}),
    };
  });
}

function operationPaths(operations: readonly ApplyPatchOperation[]): string[] {
  return operations.flatMap((operation) =>
    operation.type === 'update' && operation.movePath
      ? [operation.path, operation.movePath]
      : [operation.path]
  );
}

function sameEntry(left: PatchEntry, right: PatchEntry): boolean {
  return (
    left.kind === right.kind &&
    left.canonicalPath === right.canonicalPath &&
    (left.kind !== 'file' ||
      (left.raw !== undefined && right.raw !== undefined && left.raw.equals(right.raw)))
  );
}

async function buildPlan(
  cwd: string,
  params: unknown,
  suppliedIo?: PatchIo,
  signal?: AbortSignal
): Promise<ReadyPlan> {
  const input = requireApplyPatchInput(params);
  if (Buffer.byteLength(input, 'utf8') > APPLY_PATCH_LIMITS.patchBytes) {
    throw new Error('apply_patch input exceeds size limit');
  }
  const operations = normalizeOperations(parseApplyPatch(input));
  const chunks = operations.reduce(
    (count, operation) => count + (operation.type === 'update' ? operation.chunks.length : 0),
    0
  );
  if (chunks > APPLY_PATCH_LIMITS.chunks) throw new Error('apply_patch has too many chunks');
  const paths = operationPaths(operations);
  if (paths.length > APPLY_PATCH_LIMITS.files) throw new Error('apply_patch has too many files');
  const duplicate = paths.find((value, index) => paths.indexOf(value) !== index);
  if (duplicate) throw new Error(`Patch path is operated on more than once: ${duplicate}`);
  const foldedPaths = paths.map((value) => value.normalize('NFC').toLowerCase());
  const aliasIndex = foldedPaths.findIndex((value, index) => foldedPaths.indexOf(value) !== index);
  if (aliasIndex >= 0) throw new Error(`Patch paths have a case alias: ${paths[aliasIndex]}`);
  const pathSet = new Set(foldedPaths);
  const ancestorIndex = foldedPaths.findIndex((value) => {
    const segments = value.split('/');
    for (let length = 1; length < segments.length; length += 1) {
      if (pathSet.has(segments.slice(0, length).join('/'))) return true;
    }
    return false;
  });
  const ancestor = paths[ancestorIndex];
  if (ancestor) throw new Error(`Patch paths have an ancestor conflict: ${ancestor}`);

  const io = suppliedIo ?? createLocalApplyPatchIo(cwd);
  const snapshots = new Map<string, PatchEntry>();
  const canonical = new Map<string, string>();
  let totalReadBytes = 0;
  for (const target of paths) {
    const remainingReadBytes = APPLY_PATCH_LIMITS.totalReadBytes - totalReadBytes;
    const entry = await io.inspect(
      target,
      Math.min(APPLY_PATCH_LIMITS.fileBytes, remainingReadBytes),
      signal
    );
    if (entry.kind === 'symlink') throw new Error(`Symbolic links cannot be patched: ${target}`);
    if (entry.kind === 'directory') throw new Error(`Directories cannot be patched: ${target}`);
    if (entry.kind === 'other') throw new Error(`Patch target is not a regular file: ${target}`);
    const alias = canonical.get(entry.canonicalPath);
    if (alias) throw new Error(`Patch paths resolve to the same target: ${alias}, ${target}`);
    canonical.set(entry.canonicalPath, target);
    if (entry.raw) {
      totalReadBytes += entry.raw.length;
      if (totalReadBytes > APPLY_PATCH_LIMITS.totalReadBytes) {
        throw new Error('apply_patch total read limit exceeded');
      }
      decodePatchText(entry.raw, target);
    }
    snapshots.set(target, entry);
  }

  const actions: PhysicalAction[] = [];
  const matchBudget: MatchBudget = { remaining: APPLY_PATCH_LIMITS.comparisons };
  for (const operation of operations) {
    const source = snapshots.get(operation.path);
    if (!source) throw new Error(`Missing preflight snapshot: ${operation.path}`);
    if (operation.type === 'add') {
      if (source.kind !== 'missing')
        throw new Error(`Add target already exists: ${operation.path}`);
      actions.push({
        path: operation.path,
        type: 'add',
        before: Buffer.alloc(0),
        after: Buffer.from(operation.content, 'utf8'),
        exclusive: true,
      });
      continue;
    }
    if (source.kind !== 'file' || !source.raw) {
      throw new Error(`${operation.type} source does not exist: ${operation.path}`);
    }
    if (operation.type === 'delete') {
      actions.push({
        path: operation.path,
        type: 'delete',
        before: source.raw,
        after: Buffer.alloc(0),
      });
      continue;
    }
    const updated = applyUpdateChunks(source.raw, operation.path, operation.chunks, matchBudget);
    if (!operation.movePath) {
      if (updated.equals(source.raw)) throw new Error(`Update has no effect: ${operation.path}`);
      actions.push({
        path: operation.path,
        type: 'update',
        before: source.raw,
        after: updated,
      });
      continue;
    }
    const destination = snapshots.get(operation.movePath);
    if (destination?.kind !== 'missing') {
      throw new Error(`Move destination already exists: ${operation.movePath}`);
    }
    actions.push({
      path: operation.movePath,
      type: 'add',
      before: Buffer.alloc(0),
      after: updated,
      exclusive: true,
    });
    actions.push({
      path: operation.path,
      type: 'delete',
      before: source.raw,
      after: Buffer.alloc(0),
    });
  }
  const oversized = actions.find((action) => action.after.length > APPLY_PATCH_LIMITS.fileBytes);
  if (oversized) throw new Error(`Generated file exceeds apply_patch limit: ${oversized.path}`);
  const readyActions: ReadyAction[] = actions.map((action) => ({
    ...action,
    change: {
      path: action.path,
      oldText: decodePatchText(action.before, action.path),
      newText: decodePatchText(action.after, action.path),
      type: action.type,
    },
  }));
  return { operations, paths, io, snapshots, actions: readyActions };
}

export async function validateApplyPatchTargets(
  cwd: string,
  params: unknown,
  io?: PatchIo,
  signal?: AbortSignal
): Promise<ApplyPatchPlan> {
  const plan = await buildPlan(cwd, params, io, signal);
  return { operations: plan.operations, paths: plan.paths };
}

async function recheck(plan: ReadyPlan, path: string, signal?: AbortSignal): Promise<void> {
  const expected = plan.snapshots.get(path);
  if (!expected) throw new Error(`Missing expected snapshot for ${path}`);
  const actual = await plan.io.inspect(path, APPLY_PATCH_LIMITS.fileBytes, signal);
  if (!sameEntry(expected, actual))
    throw new Error(`File changed after apply_patch preflight: ${path}`);
}

function toChange(action: ReadyAction): AppliedFileChange {
  return action.change;
}

async function readOutcome(
  plan: ReadyPlan,
  action: PhysicalAction
): Promise<'completed' | 'unchanged' | 'uncertain'> {
  try {
    const actual = await plan.io.inspect(
      action.path,
      APPLY_PATCH_LIMITS.fileBytes,
      undefined,
      5_000
    );
    if (action.type === 'delete')
      return actual.kind === 'missing'
        ? 'completed'
        : sameEntry(plan.snapshots.get(action.path)!, actual)
          ? 'unchanged'
          : 'uncertain';
    if (actual.kind === 'file' && actual.raw?.equals(action.after)) return 'completed';
    return sameEntry(plan.snapshots.get(action.path)!, actual) ? 'unchanged' : 'uncertain';
  } catch {
    return 'uncertain';
  }
}

function result(
  fileChanges: AppliedFileChange[],
  error?: string,
  failed: string[] = [],
  unattempted: string[] = [],
  uncertain: string[] = []
): { content: Array<{ type: 'text'; text: string }>; details: ApplyPatchDetails } {
  const applied = fileChanges.map((change) => change.path);
  const status = error ? (applied.length > 0 ? 'partial' : 'failed') : 'success';
  const details: ApplyPatchDetails = {
    kind: 'apply_patch',
    status,
    fileChanges,
    applied,
    failed,
    ...(error ? { error } : {}),
    unattempted,
    uncertain,
  };
  const lines =
    status === 'success'
      ? ['Applied patch successfully:', ...applied.map((path) => `- ${path}`)]
      : [
          `Patch ${status}.`,
          `Applied: ${applied.length ? applied.join(', ') : '(none)'}`,
          `Failed paths: ${failed.length ? failed.join(', ') : '(none)'}`,
          `Error: ${error}`,
          `Unattempted: ${unattempted.length ? unattempted.join(', ') : '(none)'}`,
          `Uncertain: ${uncertain.length ? uncertain.join(', ') : '(none)'}`,
          'Re-read failed or uncertain paths before retrying.',
        ];
  return { content: [{ type: 'text', text: lines.join('\n') }], details };
}

async function runPlan(plan: ReadyPlan, signal?: AbortSignal) {
  for (const target of plan.paths) await recheck(plan, target, signal);
  const changes: AppliedFileChange[] = [];
  for (let index = 0; index < plan.actions.length; index += 1) {
    const action = plan.actions[index];
    if (signal?.aborted) {
      return result(
        changes,
        'apply_patch cancelled',
        [],
        plan.actions.slice(index).map((entry) => entry.path)
      );
    }
    try {
      await recheck(plan, action.path, signal);
    } catch (error) {
      if (signal?.aborted) {
        return result(
          changes,
          'apply_patch cancelled',
          [],
          plan.actions.slice(index).map((entry) => entry.path)
        );
      }
      return result(
        changes,
        error instanceof Error ? error.message : String(error),
        [action.path],
        plan.actions.slice(index + 1).map((entry) => entry.path)
      );
    }
    if (signal?.aborted) {
      return result(
        changes,
        'apply_patch cancelled',
        [],
        plan.actions.slice(index).map((entry) => entry.path)
      );
    }
    try {
      if (action.type === 'delete') await plan.io.remove(action.path, signal);
      else
        await plan.io.write(action.path, action.after, {
          exclusive: action.exclusive === true,
          signal,
        });
      changes.push(toChange(action));
    } catch (error) {
      if (error instanceof PatchMutationUncertainError) {
        return result(
          changes,
          error.message,
          [],
          plan.actions.slice(index + 1).map((entry) => entry.path),
          [action.path]
        );
      }
      const outcome = await readOutcome(plan, action);
      if (outcome === 'completed') changes.push(toChange(action));
      const uncertain = outcome === 'uncertain' ? [action.path] : [];
      return result(
        changes,
        error instanceof Error ? error.message : String(error),
        outcome === 'unchanged' ? [action.path] : [],
        plan.actions.slice(index + 1).map((entry) => entry.path),
        uncertain
      );
    }
  }
  return result(changes);
}

export function executeApplyPatch(
  cwd: string,
  params: unknown,
  options: { io?: PatchIo; signal?: AbortSignal } = {}
): Promise<{ content: Array<{ type: 'text'; text: string }>; details: ApplyPatchDetails }> {
  return enqueue(async () =>
    runPlan(await buildPlan(cwd, params, options.io, options.signal), options.signal)
  );
}
