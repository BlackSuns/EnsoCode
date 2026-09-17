import { randomUUID } from 'node:crypto';
import type { CatalogEntry } from '@enso/pair';
import {
  catalogEntryFromPairSession,
  catalogQueued,
  patchCatalogEntry,
  upsertCatalogEntry,
} from '@shared/pair/headlessCatalog';
import {
  applyHeadlessQueueAction,
  emptyHeadlessRuntime,
  type HeadlessDelivery,
  type HeadlessSessionRuntime,
  onHeadlessIdle,
} from '@shared/pair/headlessQueue';
import { type PersistedPairConversation, planPairResume } from '@shared/pair/headlessResume';
import type { AgentSpawnRequest, AttachedImage, RendererAgentEvent } from '@shared/types/agent';
import type { PairCreatedSession, PairQueueAction, PairSessionConfig } from '@shared/types/pair';
import { patchConversationsState, readPersistedConversation } from '../ipc/settings';
import { getPairCatalog, getPairProjects, mutatePairCatalog } from './pairHost';

export interface PairSessionHostAgent {
  isAlive(sessionId: string): boolean;
  requestSnapshot(sessionId: string): void;
  spawn(request: AgentSpawnRequest): Promise<{ ok: boolean; error?: string }>;
  prompt(sessionId: string, text: string, images?: AttachedImage[]): void;
  steer(sessionId: string, text: string, images?: AttachedImage[]): void;
  abort(sessionId: string): void;
  setModel(sessionId: string, providerId: string, modelId: string): void;
  setReasoning(sessionId: string, enabled: boolean, level?: string): void;
  setThinking(sessionId: string, level: string): void;
  compact(sessionId: string, instructions?: string): void;
  rewind(sessionId: string, userIndexFromEnd: number, restoreFiles?: boolean): void;
  retry(sessionId: string): void;
  stopTask(sessionId: string, taskId: string): void;
  stopSubagent(sessionId: string, agentId: string): void;
  createAuthority(sessionId: string, projectId: string): void;
  worktreePath(sessionId: string): string | undefined;
  worktreeMissing(sessionId: string): boolean;
  projectPath(projectId: string): string | undefined;
  loadLocalSkills(): boolean;
}

let agent: PairSessionHostAgent | null = null;
let headless = false;
const runtimes = new Map<string, HeadlessSessionRuntime>();
const pendingInterrupt = new Map<string, string>();

export function configurePairSessionHost(next: PairSessionHostAgent): void {
  agent = next;
}

export function setPairHeadless(active: boolean): void {
  headless = active;
  if (!active) {
    runtimes.clear();
    pendingInterrupt.clear();
    return;
  }
  seedRuntimes();
}

export function isPairHeadless(): boolean {
  return headless;
}

export function headlessIdleBlocks(): {
  queuedCount: number;
  pendingAskCount: number;
  pendingApprovalCount: number;
} {
  let queuedCount = 0;
  let pendingAskCount = 0;
  let pendingApprovalCount = 0;
  for (const runtime of runtimes.values()) {
    queuedCount += runtime.queued.length;
    pendingAskCount += runtime.pendingAsks;
    pendingApprovalCount += runtime.pendingApprovals;
  }
  return { queuedCount, pendingAskCount, pendingApprovalCount };
}

function runtimeOf(sessionId: string): HeadlessSessionRuntime {
  const current = runtimes.get(sessionId);
  if (current) return current;
  const seeded = emptyHeadlessRuntime();
  runtimes.set(sessionId, seeded);
  return seeded;
}

function setRuntime(sessionId: string, runtime: HeadlessSessionRuntime): void {
  runtimes.set(sessionId, runtime);
}

function persistRuntime(sessionId: string, runtime: HeadlessSessionRuntime): void {
  patchConversationsState((state) => {
    const current = state.conversations[sessionId];
    if (!current) return;
    state.conversations[sessionId] = {
      ...current,
      queuedMessages: runtime.queued,
      ...(runtime.goal ? { goal: runtime.goal } : { goal: undefined }),
    };
  });
}

function pushCatalog(sessionId: string, runtime: HeadlessSessionRuntime, extra?: object): void {
  mutatePairCatalog(
    (catalog) =>
      patchCatalogEntry(catalog, sessionId, {
        status: runtime.status,
        queued: catalogQueued(runtime.queued),
        ...(runtime.goal
          ? {
              goal: {
                text: runtime.goal.text,
                status: runtime.goal.status,
                ...(runtime.goal.note ? { note: runtime.goal.note } : {}),
                autoTurns: runtime.goal.autoTurns,
              },
            }
          : { goal: undefined }),
        ...extra,
      }) as CatalogEntry[]
  );
}

function deliver(sessionId: string, delivery: HeadlessDelivery): void {
  if (delivery.kind === 'steer') agent?.steer(sessionId, delivery.text, delivery.images);
  else agent?.prompt(sessionId, delivery.text, delivery.images);
}

function seedRuntimes(): void {
  runtimes.clear();
  for (const entry of getPairCatalog()) {
    const persisted = readPersistedConversation(entry.id);
    const queued = Array.isArray(persisted?.queuedMessages)
      ? persisted.queuedMessages.filter(
          (
            item
          ): item is {
            id: string;
            text: string;
            images?: HeadlessSessionRuntime['queued'][number]['images'];
          } =>
            Boolean(
              item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
            )
        )
      : (entry.queued ?? []).map((item) => ({ id: item.id, text: item.text }));
    const goal =
      entry.goal ??
      (persisted?.goal && typeof persisted.goal === 'object'
        ? (persisted.goal as HeadlessSessionRuntime['goal'])
        : undefined);
    runtimes.set(entry.id, {
      status: entry.status,
      started: agent?.isAlive(entry.id) === true || entry.status === 'running',
      queued,
      goal,
      pendingApprovals: entry.pendingApprovalCount ?? 0,
      pendingAsks: entry.pendingAskCount ?? 0,
      compaction: false,
      abortRequested: false,
    });
  }
}

function persistedForResume(sessionId: string): PersistedPairConversation | null {
  const row = readPersistedConversation(sessionId);
  if (!row) return null;
  const projectId = typeof row.projectId === 'string' ? row.projectId : '';
  if (!projectId) return null;
  return {
    sessionId,
    projectId,
    ...(typeof row.sessionFile === 'string' ? { sessionFile: row.sessionFile } : {}),
    ...(typeof row.lastProviderId === 'string' ? { lastProviderId: row.lastProviderId } : {}),
    ...(typeof row.lastModelId === 'string' ? { lastModelId: row.lastModelId } : {}),
    ...(typeof row.reasoningEnabled === 'boolean'
      ? { reasoningEnabled: row.reasoningEnabled }
      : {}),
    ...(typeof row.thinkingLevel === 'string' ? { thinkingLevel: row.thinkingLevel } : {}),
    ...(typeof row.presetId === 'string' ? { presetId: row.presetId } : {}),
    ...(typeof row.approvalMode === 'string' ? { approvalMode: row.approvalMode } : {}),
  };
}

export async function resumePairSessionHeadless(sessionId: string): Promise<void> {
  if (!agent) return;
  const conversation = persistedForResume(sessionId);
  const plan = planPairResume({
    alive: agent.isAlive(sessionId),
    conversation,
    projectPath: conversation ? agent.projectPath(conversation.projectId) : undefined,
    worktreePath: agent.worktreePath(sessionId),
    worktreeMissing: agent.worktreeMissing(sessionId),
    loadLocalSkills: agent.loadLocalSkills(),
  });
  if (plan.type === 'snapshot') {
    agent.requestSnapshot(sessionId);
    const runtime = runtimeOf(sessionId);
    setRuntime(sessionId, { ...runtime, started: true });
    return;
  }
  if (plan.type === 'skip') return;
  const result = await agent.spawn(plan.request);
  if (result.ok) {
    const runtime = runtimeOf(sessionId);
    setRuntime(sessionId, { ...runtime, started: true, status: 'idle' });
  }
}

export function adoptPairSessionHeadless(session: PairCreatedSession): void {
  const createdAt = Date.now();
  patchConversationsState((state) => {
    if (state.conversations[session.sessionId]) return;
    state.conversations[session.sessionId] = {
      id: session.sessionId,
      projectId: session.projectId,
      title: '',
      createdAt,
      lastActiveAt: createdAt,
      messages: [],
      commands: [],
      customEntries: [],
      dispatchMainEvents: {},
      lastSeq: 0,
      spawning: false,
      status: 'idle',
      started: false,
      reasoningEnabled: session.reasoningEnabled,
      thinkingLevel: session.thinkingLevel ?? 'medium',
      lastProviderId: session.providerId,
      lastModelId: session.modelId,
      ...(session.presetId ? { presetId: session.presetId } : {}),
      ...(session.approvalMode ? { approvalMode: session.approvalMode } : {}),
    };
    state.order = [session.sessionId, ...state.order.filter((id) => id !== session.sessionId)];
  });
  agent?.createAuthority(session.sessionId, session.projectId);
  const projectName =
    getPairProjects().find((project) => project.id === session.projectId)?.name ?? '';
  mutatePairCatalog(
    (catalog) =>
      upsertCatalogEntry(
        catalog,
        catalogEntryFromPairSession(session, projectName)
      ) as CatalogEntry[]
  );
  setRuntime(session.sessionId, {
    ...emptyHeadlessRuntime(),
    started: true,
    status: 'idle',
  });
}

export function applyPairSessionConfigHeadless(config: PairSessionConfig): void {
  const sessionId = config.sessionId;
  const runtime = runtimeOf(sessionId);
  if (config.type === 'set-model') {
    patchConversationsState((state) => {
      const current = state.conversations[sessionId];
      if (!current) return;
      state.conversations[sessionId] = {
        ...current,
        lastProviderId: config.providerId,
        lastModelId: config.modelId,
      };
    });
    pushCatalog(sessionId, runtime, { providerId: config.providerId, modelId: config.modelId });
    if (runtime.started) agent?.setModel(sessionId, config.providerId, config.modelId);
    return;
  }
  if (config.type === 'set-reasoning') {
    patchConversationsState((state) => {
      const current = state.conversations[sessionId];
      if (!current) return;
      state.conversations[sessionId] = { ...current, reasoningEnabled: config.enabled };
    });
    pushCatalog(sessionId, runtime, { reasoningEnabled: config.enabled });
    if (runtime.started) {
      const level = readPersistedConversation(sessionId)?.thinkingLevel;
      agent?.setReasoning(sessionId, config.enabled, typeof level === 'string' ? level : undefined);
    }
    return;
  }
  patchConversationsState((state) => {
    const current = state.conversations[sessionId];
    if (!current) return;
    state.conversations[sessionId] = { ...current, thinkingLevel: config.level };
  });
  pushCatalog(sessionId, runtime, { thinkingLevel: config.level });
  if (runtime.started) agent?.setThinking(sessionId, config.level);
}

export function applyPairQueueActionHeadless(action: PairQueueAction): void {
  const sessionId = action.sessionId;
  if (action.type === 'compact') {
    agent?.compact(sessionId, action.instructions);
    return;
  }
  if (action.type === 'rewind') {
    agent?.rewind(sessionId, action.userIndexFromEnd, action.restoreFiles);
    return;
  }
  if (action.type === 'retry') {
    agent?.retry(sessionId);
    return;
  }
  if (action.type === 'task-stop') {
    agent?.stopTask(sessionId, action.taskId);
    return;
  }
  if (action.type === 'subagent-stop') {
    agent?.stopSubagent(sessionId, action.agentId);
    return;
  }
  const applied = applyHeadlessQueueAction(runtimeOf(sessionId), action, randomUUID);
  setRuntime(sessionId, applied.runtime);
  persistRuntime(sessionId, applied.runtime);
  pushCatalog(sessionId, applied.runtime);
  if (applied.abort) {
    pendingInterrupt.set(sessionId, action.type === 'queue-interrupt-send' ? action.messageId : '');
    agent?.abort(sessionId);
    return;
  }
  if (applied.deliver) deliver(sessionId, applied.deliver);
}

export function handlePairHeadlessAgentEvent(event: RendererAgentEvent): void {
  if (!headless) return;
  const sessionId =
    'identity' in event && event.identity && 'sessionId' in event.identity
      ? event.identity.sessionId
      : 'sessionId' in event
        ? event.sessionId
        : undefined;
  if (typeof sessionId !== 'string' || !sessionId) return;
  const runtime = runtimeOf(sessionId);
  if (event.type === 'approval-request') {
    setRuntime(sessionId, { ...runtime, pendingApprovals: runtime.pendingApprovals + 1 });
    return;
  }
  if (event.type === 'ask-request') {
    setRuntime(sessionId, { ...runtime, pendingAsks: runtime.pendingAsks + 1 });
    return;
  }
  if (event.type === 'status') {
    const status = event.status;
    if (status === 'running') {
      const next = { ...runtime, started: true, status };
      setRuntime(sessionId, next);
      pushCatalog(sessionId, next);
      return;
    }
    if (status === 'idle' || status === 'failed') {
      finishTurn(sessionId, { ...runtime, started: true, status });
    }
    return;
  }
  if (event.type === 'turn-completed' || event.type === 'turn-failed') {
    finishTurn(sessionId, { ...runtime, started: true, pendingApprovals: 0, pendingAsks: 0 });
  }
}

function finishTurn(sessionId: string, runtime: HeadlessSessionRuntime): void {
  const interruptId = pendingInterrupt.get(sessionId);
  const idle = onHeadlessIdle(runtime);
  let next = idle.runtime;
  let delivery = idle.deliver;
  if (interruptId) {
    pendingInterrupt.delete(sessionId);
    const sent = applyHeadlessQueueAction(
      next,
      { type: 'queue-send-now', sessionId, messageId: interruptId },
      randomUUID
    );
    next = sent.runtime;
    delivery = sent.deliver;
  }
  setRuntime(sessionId, next);
  persistRuntime(sessionId, next);
  pushCatalog(sessionId, next);
  if (delivery) deliver(sessionId, delivery);
}
