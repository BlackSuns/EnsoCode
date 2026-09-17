import type { RendererAgentEvent } from '@shared/types/agent';

export type TraySleepPolicy = 'when-agent-running' | 'never';

export function parseTraySleepPolicy(value: unknown): TraySleepPolicy {
  return value === 'never' ? 'never' : 'when-agent-running';
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
