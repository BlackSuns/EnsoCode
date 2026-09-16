import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentWorkerEvent } from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SILENT_TURN_NUDGE } from './silentTurn';

const mocks = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  managers: [] as Array<Record<string, unknown>>,
  mcpToolsFor: vi.fn(),
  createAgentSession: vi.fn(),
}));

vi.mock('./cursor/loadProvider', () => ({
  CURSOR_PROVIDER_ID: 'cursor',
  loadCursorProvider: vi.fn(async () => undefined),
}));

vi.mock('./mcp', () => ({
  McpManager: class {
    toolsFor = mocks.mcpToolsFor;
    closeAll = vi.fn(async () => undefined);
  },
}));

vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  class Loader {
    async reload() {}
    getSkills() {
      return { skills: [] };
    }
    getPrompts() {
      return { prompts: [] };
    }
  }
  const manager = () => {
    const branch: unknown[] = [];
    const value = {
      getBranch: vi.fn(() => branch),
      appendCustomEntry: vi.fn((customType: string, data: unknown) => {
        branch.push({ type: 'custom', customType, data });
        return `entry-${branch.length}`;
      }),
      buildSessionContext: vi.fn(() => ({ messages: [] })),
    };
    mocks.managers.push(value);
    return value;
  };
  const runtime = {
    models: new Map<string, Record<string, unknown>>(),
    registerProvider(providerId: string, config: { models?: Record<string, unknown>[] }) {
      for (const model of config.models ?? []) {
        this.models.set(`${providerId}/${model.id}`, { ...model, provider: providerId });
      }
    },
    getModel(providerId: string, modelId: string) {
      return this.models.get(`${providerId}/${modelId}`);
    },
    getModels() {
      return [...this.models.values()];
    },
    refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
    completeSimple: vi.fn(async () => ({ content: [] })),
  };
  return {
    ...original,
    DefaultResourceLoader: Loader,
    ModelRuntime: { create: vi.fn(async () => runtime) },
    SessionManager: { create: vi.fn(manager), open: vi.fn(manager), inMemory: vi.fn(manager) },
    createAgentSession: mocks.createAgentSession,
  };
});

import { SessionSupervisor } from './supervisor';

const parent = {
  sessionId: 'parent',
  generation: '11111111-1111-4111-8111-111111111111',
};
const model = {
  api: 'openai-completions' as const,
  baseUrl: 'https://example.test/v1',
  apiKey: 'secret',
  modelId: 'model',
  settingsProviderId: 'settings-provider',
};

function session(options: Record<string, unknown>) {
  const listeners = new Set<(event: { type: string; [key: string]: unknown }) => void>();
  const agentState = {
    messages: [] as unknown[],
    systemPrompt: 'base system',
  };
  const agent = {
    state: agentState,
    continue: vi.fn(async () => {
      agent.promptAtContinue = agentState.systemPrompt;
    }),
    promptAtContinue: undefined as string | undefined,
  };
  const value = {
    model: options.model,
    resourceLoader: options.resourceLoader,
    sessionManager: options.sessionManager,
    sessionFile: `/tmp/session-${mocks.sessions.length}.jsonl`,
    agent,
    get messages() {
      return agentState.messages;
    },
    set messages(next: unknown[]) {
      agentState.messages = next;
    },
    subscribe: vi.fn((listener: (event: { type: string; [key: string]: unknown }) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(event: { type: string; [key: string]: unknown }) {
      for (const listener of listeners) listener(event);
    },
    prompt: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
    dispose: vi.fn(),
    setThinkingLevel: vi.fn(),
    navigateTree: vi.fn(async () => ({ cancelled: false })),
    isStreaming: false,
    isRetrying: false,
  };
  mocks.sessions.push(value);
  return value;
}

async function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

async function waitFor(events: AgentWorkerEvent[], type: AgentWorkerEvent['type']): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (events.some((event) => event.type === type)) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${type}`);
}

describe('SessionSupervisor silent turn recovery', () => {
  let sessionDir = '';

  beforeEach(() => {
    mocks.sessions.length = 0;
    mocks.managers.length = 0;
    mocks.createAgentSession.mockReset();
    mocks.mcpToolsFor.mockReset().mockResolvedValue([]);
    sessionDir = mkdtempSync(path.join(tmpdir(), 'enso-silent-'));
    mocks.createAgentSession.mockImplementation(async (options: Record<string, unknown>) => ({
      session: session(options),
    }));
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  async function spawn(): Promise<{
    events: AgentWorkerEvent[];
    supervisor: SessionSupervisor;
    parentSession: ReturnType<typeof session>;
  }> {
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      emit: (event) => events.push(event),
      agentDir: '/tmp/agent',
      sessionDir,
    });
    supervisor.handleCommand({
      type: 'spawn-parent',
      identity: parent,
      cwd: '/workspace',
      model,
    });
    await waitFor(events, 'parent-ready');
    return { events, supervisor, parentSession: mocks.sessions[0] as ReturnType<typeof session> };
  }

  it('空回复不 settle，摘掉空 assistant 后 continue 一次，并把 nudge 写进当次 systemPrompt', async () => {
    const { events, supervisor, parentSession } = await spawn();
    parentSession.emit({ type: 'agent_start' });
    await settle();
    parentSession.messages.push(
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [] }
    );
    const mark = events.length;
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();
    const after = events.slice(mark);

    expect(parentSession.agent.continue).toHaveBeenCalledTimes(1);
    expect(parentSession.agent.promptAtContinue).toContain(SILENT_TURN_NUDGE);
    expect(parentSession.agent.state.systemPrompt).toBe('base system');
    expect(after.some((event) => event.type === 'turn-completed')).toBe(false);
    expect(after.some((event) => event.type === 'turn-failed')).toBe(false);
    expect(after.some((event) => event.type === 'status' && event.status === 'idle')).toBe(false);
    expect(after.some((event) => event.type === 'messages-truncated')).toBe(true);
    expect(parentSession.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]);

    await supervisor.shutdown();
  });

  it('恢复后再空回复只 continue 一次，第二次按完成收口', async () => {
    const { events, supervisor, parentSession } = await spawn();
    parentSession.emit({ type: 'agent_start' });
    await settle();
    parentSession.messages.push(
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [] }
    );
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();
    expect(parentSession.agent.continue).toHaveBeenCalledTimes(1);

    parentSession.messages.push({ role: 'assistant', content: [] });
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();

    expect(parentSession.agent.continue).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'turn-completed')).toBe(true);

    await supervisor.shutdown();
  });

  it('有正文或 toolCall 的轮次不触发恢复', async () => {
    const { events, supervisor, parentSession } = await spawn();
    parentSession.emit({ type: 'agent_start' });
    await settle();
    parentSession.messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
    });
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    expect(parentSession.agent.continue).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'turn-completed')).toBe(true);

    await supervisor.shutdown();
  });

  it('willRetry 与终态错误优先，不走空轮次恢复', async () => {
    const { events, supervisor, parentSession } = await spawn();
    parentSession.emit({ type: 'agent_start' });
    await settle();
    parentSession.messages.push({ role: 'assistant', content: [], stopReason: 'error' });
    parentSession.emit({ type: 'agent_end', willRetry: true });
    await settle();
    expect(parentSession.agent.continue).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'turn-completed')).toBe(false);
    expect(events.some((event) => event.type === 'turn-failed')).toBe(false);

    parentSession.messages.push({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: 'down',
    });
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();
    expect(parentSession.agent.continue).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'turn-failed')).toBe(true);

    await supervisor.shutdown();
  });

  it('下一轮新的 agent_start 后空回复可以再恢复一次', async () => {
    const { events, supervisor, parentSession } = await spawn();
    parentSession.emit({ type: 'agent_start' });
    await settle();
    parentSession.messages.push(
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: [] }
    );
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();

    parentSession.messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
    });
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();
    expect(events.some((event) => event.type === 'turn-completed')).toBe(true);
    expect(parentSession.agent.continue).toHaveBeenCalledTimes(1);

    parentSession.emit({ type: 'agent_start' });
    await settle();
    parentSession.messages.push(
      { role: 'user', content: [{ type: 'text', text: 'again' }] },
      { role: 'assistant', content: [] }
    );
    parentSession.emit({ type: 'agent_end', willRetry: false });
    await settle();
    await settle();
    expect(parentSession.agent.continue).toHaveBeenCalledTimes(2);

    await supervisor.shutdown();
  });
});
