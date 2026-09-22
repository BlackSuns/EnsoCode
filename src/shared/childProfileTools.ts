import type { EditMode } from './types/editMode';

/**
 * 子代理 profile 的内置工具 id。Main 用父会话 spawn 时的同一组输入预测 worker
 * 实际注册的工具，exact profile proof 才能对上。
 */
export interface ChildProfileToolInput {
  tools: 'readonly' | 'all';
  editMode: EditMode;
  isolatedSandboxEnabled: boolean;
  exploreFoldEnabled: boolean;
}

export function childProfileToolIds(input: ChildProfileToolInput): readonly string[] {
  const readOnly = ['read', 'grep', 'find', 'ls'];
  const base =
    input.tools === 'readonly'
      ? readOnly
      : [
          ...readOnly,
          'bash',
          ...(input.editMode === 'apply_patch' ? ['apply_patch'] : ['edit', 'write']),
        ];
  return [
    ...base,
    'message_main_agent',
    'message_coworker',
    ...(input.isolatedSandboxEnabled ? ['exec'] : []),
    ...(input.exploreFoldEnabled ? ['explore_mark', 'explore_fold'] : []),
  ];
}
