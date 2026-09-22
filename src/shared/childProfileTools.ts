import type { EditMode } from './types/editMode';

/**
 * 子代理 profile 的内置工具 id：worker 侧按同一批设置构建工具，Main 侧据此做
 * exact profile proof 收窄。两侧必须共用这一个推导，不能各自硬编码。
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
