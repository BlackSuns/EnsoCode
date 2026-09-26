import type { WorkspaceBranches } from '@shared/types/worktree';

export type QuickActionGitStatus = Pick<
  WorkspaceBranches,
  'currentBranch' | 'defaultBranch' | 'dirty'
>;

/** label / prompt 均为 i18n key；prompt 按界面语言翻译后原样作为用户消息发送 */
export interface QuickAction {
  id: 'commit' | 'pr' | 'runServer';
  label: string;
  prompt: string;
}

/** 一轮结束后输入框上方的快捷操作，按展示顺序返回 */
export function quickActions(
  status: QuickActionGitStatus | null,
  hasSession: boolean
): QuickAction[] {
  if (!hasSession) return [];
  // 「在后台」不可省：否则模型用前台 bash 起服务，超时后服务随之退出
  const runServer: QuickAction = {
    id: 'runServer',
    label: 'Start server',
    prompt: 'start the dev server in the background',
  };
  if (!status?.currentBranch) return [runServer];
  const actions: QuickAction[] = [];
  if (status.dirty) actions.push({ id: 'commit', label: 'Commit', prompt: 'commit your changes' });
  // 领先基线的提交数拿不到，非默认分支一律视为可能有内容
  if (status.defaultBranch && status.currentBranch !== status.defaultBranch)
    actions.push({ id: 'pr', label: 'Create PR', prompt: 'create a PR' });
  return [...actions, runServer];
}
