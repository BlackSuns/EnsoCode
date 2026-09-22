import type { AgentWorkerEvent } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { AgentControlInvoker } from './agentControl';

describe('unified Agent wait cancellation', () => {
  it('interrupts only the observation RPC and never emits stop or dismiss', async () => {
    const emitted: AgentWorkerEvent[] = [];
    const invoker = new AgentControlInvoker(
      {
        sessionId: 'parent',
        generation: '11111111-1111-4111-8111-111111111111',
      },
      (event) => emitted.push(event),
      () => 'wait-request'
    );
    const controller = new AbortController();
    const pending = invoker.invoke(
      { operation: 'wait', runIds: ['run-1'], until: 'all' },
      controller.signal
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/wait interrupted/i);
    expect(emitted.map((event) => event.type)).toEqual([
      'agent-control-invoke',
      'agent-control-cancel',
    ]);
  });
});
