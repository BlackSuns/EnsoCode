import { describe, expect, it, vi } from 'vitest';

vi.mock('../../agent/index?modulePath', () => ({ default: '/tmp/agent.js' }));

import {
  expectedAgentTypeToolIds,
  rememberParentToolProfile,
  resolvePresetSystemPrompt,
} from './agentHost';

describe('agentHost agent type tool filtering', () => {
  it('all 子会话允许 apply_patch，readonly 仍不开放写工具', () => {
    expect(expectedAgentTypeToolIds('all')).toContain('apply_patch');
    expect(expectedAgentTypeToolIds('readonly')).not.toContain('apply_patch');
  });

  it('proof 使用父会话 spawn 时的工具档，而不是后来的全局设置', () => {
    rememberParentToolProfile('parent-snapshot', {
      editMode: 'replace',
      isolatedSandboxEnabled: false,
      exploreFoldEnabled: false,
    });
    expect(expectedAgentTypeToolIds('all', { parentSessionId: 'parent-snapshot' })).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'edit',
      'write',
      'message_main_agent',
      'message_coworker',
    ]);
    expect(
      expectedAgentTypeToolIds('readonly', { parentSessionId: 'parent-snapshot' })
    ).not.toContain('bash');
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
