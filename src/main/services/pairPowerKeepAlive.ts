import type { RendererAgentEvent } from '@shared/types/agent';

export type TraySleepPolicy = 'when-agent-running' | 'never';

export function parseTraySleepPolicy(value: unknown): TraySleepPolicy {
  return value === 'never' ? 'never' : 'when-agent-running';
}

/** 只有用户显式打开才在持锁期间阻止息屏。 */
export function parseTrayPreventDisplaySleep(value: unknown): boolean {
  return value === true;
}

export type PowerSaveBlockerKind = 'prevent-app-suspension' | 'prevent-display-sleep';

export function powerSaveBlockerKind(preventDisplaySleep: boolean): PowerSaveBlockerKind {
  return preventDisplaySleep ? 'prevent-display-sleep' : 'prevent-app-suspension';
}

/** 托盘策略：有 agent 在跑，或用户选了永远不休眠。 */
export function shouldHoldPairPowerKeepAlive(
  policy: TraySleepPolicy,
  runningTaskCount: number
): boolean {
  return policy === 'never' || runningTaskCount > 0;
}

export function applyPairPowerTaskEvent(
  runningTaskIds: ReadonlySet<string>,
  event: RendererAgentEvent
): Set<string> {
  const next = new Set(runningTaskIds);
  switch (event.type) {
    case 'status': {
      const id = event.identity.sessionId;
      if (event.status === 'running') next.add(id);
      else next.delete(id);
      return next;
    }
    case 'snapshot': {
      if (!event.partial) next.clear();
      for (const session of event.sessions) {
        const id = session.identity.sessionId;
        if (session.status === 'running') next.add(id);
        else next.delete(id);
      }
      return next;
    }
    case 'worker-exited':
      next.clear();
      return next;
    case 'parent-ended':
    case 'parent-rejected':
    case 'child-ended':
    case 'child-rejected':
      next.delete(event.identity.sessionId);
      return next;
    default:
      return next;
  }
}
