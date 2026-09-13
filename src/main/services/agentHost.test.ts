import { describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));

import { expectedAgentTypeToolIds } from './agentHost';

describe('agentHost agent type tool filtering', () => {
  it('all 子会话允许 apply_patch，readonly 仍不开放写工具', () => {
    expect(expectedAgentTypeToolIds('all')).toContain('apply_patch');
    expect(expectedAgentTypeToolIds('readonly')).not.toContain('apply_patch');
  });
});
