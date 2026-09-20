import { describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));

import { expectedAgentTypeToolIds, resolvePresetSystemPrompt } from './agentHost';

describe('agentHost agent type tool filtering', () => {
  it('all 子会话允许 apply_patch，readonly 仍不开放写工具', () => {
    expect(expectedAgentTypeToolIds('all')).toContain('apply_patch');
    expect(expectedAgentTypeToolIds('readonly')).not.toContain('apply_patch');
  });
});

describe('agentHost preset system prompt authority', () => {
  it('无引用沿用默认，引用正文读取失败时明确拒绝 spawn 所需配置', () => {
    expect(resolvePresetSystemPrompt()).toEqual({ ok: true });
    expect(
      resolvePresetSystemPrompt({ systemPromptId: '11111111-1111-4111-8111-111111111111' })
    ).toEqual({ ok: false });
  });
});
