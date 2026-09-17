import type { SessionIdentity } from '@shared/builtinAgents';
import type { RendererAgentEvent, SessionSnapshot } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import {
  applyPairPowerTaskEvent,
  parseTraySleepPolicy,
  shouldHoldPairPowerKeepAlive,
} from './pairPowerKeepAlive';

const identity = (sessionId: string): SessionIdentity => ({
  sessionId,
  generation: '11111111-1111-4111-8111-111111111111',
});

const snapshot = (sessionId: string, status: SessionSnapshot['status']): SessionSnapshot =>
  ({
    identity: identity(sessionId),
    status,
    messages: [],
    commands: [],
  }) as SessionSnapshot;

describe('shouldHoldPairPowerKeepAlive', () => {
  it('默认策略：只有 agent 在跑才持锁', () => {
    expect(shouldHoldPairPowerKeepAlive('when-agent-running', 0)).toBe(false);
    expect(shouldHoldPairPowerKeepAlive('when-agent-running', 1)).toBe(true);
  });

  it('永远不休眠：没有 agent 也持锁', () => {
    expect(shouldHoldPairPowerKeepAlive('never', 0)).toBe(true);
  });

  it('脏值回落到有 agent 才持锁', () => {
    expect(parseTraySleepPolicy(undefined)).toBe('when-agent-running');
    expect(parseTraySleepPolicy('never')).toBe('never');
    expect(parseTraySleepPolicy('always')).toBe('when-agent-running');
  });
});

describe('applyPairPowerTaskEvent', () => {
  it('status=running 记入任务，idle/failed 清除', () => {
    let running = new Set<string>();
    running = applyPairPowerTaskEvent(running, {
      type: 'status',
      identity: identity('a'),
      seq: 1,
      status: 'running',
    });
    expect([...running]).toEqual(['a']);

    running = applyPairPowerTaskEvent(running, {
      type: 'status',
      identity: identity('a'),
      seq: 2,
      status: 'idle',
    });
    expect(running.size).toBe(0);
  });

  it('全量 snapshot 以 running 会话重置集合', () => {
    let running = new Set(['stale']);
    running = applyPairPowerTaskEvent(running, {
      type: 'snapshot',
      sessions: [snapshot('a', 'running'), snapshot('b', 'idle')],
    });
    expect([...running]).toEqual(['a']);
  });

  it('worker-exited 清空任务', () => {
    const running = applyPairPowerTaskEvent(new Set(['a', 'b']), { type: 'worker-exited' });
    expect(running.size).toBe(0);
  });

  it('无关事件不改集合', () => {
    const prev = new Set(['a']);
    const next = applyPairPowerTaskEvent(prev, {
      type: 'message-upsert',
      identity: identity('a'),
      seq: 1,
      index: 0,
      message: { role: 'assistant', content: [] },
    } as RendererAgentEvent);
    expect(next).toEqual(prev);
  });
});
