import { describe, expect, it } from 'vitest';
import { childProfileToolIds } from './childProfileTools';

describe('childProfileToolIds', () => {
  it('all 档按 editMode 给出唯一变更工具，并跟随 isolated_sandbox/explore 设置', () => {
    expect(
      childProfileToolIds({
        tools: 'all',
        editMode: 'apply_patch',
        isolatedSandboxEnabled: true,
        exploreFoldEnabled: false,
      })
    ).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'apply_patch',
      'message_main_agent',
      'message_coworker',
      'exec',
    ]);
    expect(
      childProfileToolIds({
        tools: 'all',
        editMode: 'replace',
        isolatedSandboxEnabled: false,
        exploreFoldEnabled: true,
      })
    ).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'bash',
      'edit',
      'write',
      'message_main_agent',
      'message_coworker',
      'explore_mark',
      'explore_fold',
    ]);
  });

  it('readonly 档永不包含变更工具', () => {
    const ids = childProfileToolIds({
      tools: 'readonly',
      editMode: 'apply_patch',
      isolatedSandboxEnabled: true,
      exploreFoldEnabled: true,
    });
    expect(ids).toEqual([
      'read',
      'grep',
      'find',
      'ls',
      'message_main_agent',
      'message_coworker',
      'exec',
      'explore_mark',
      'explore_fold',
    ]);
    for (const mutating of ['bash', 'apply_patch', 'edit', 'write']) {
      expect(ids).not.toContain(mutating);
    }
  });
});
