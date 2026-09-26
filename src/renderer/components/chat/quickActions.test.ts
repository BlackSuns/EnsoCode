import { describe, expect, it } from 'vitest';
import { type QuickActionGitStatus, quickActions } from './quickActions';

const git = (patch: Partial<QuickActionGitStatus> = {}): QuickActionGitStatus => ({
  currentBranch: 'main',
  defaultBranch: 'main',
  dirty: false,
  ...patch,
});
const ids = (status: QuickActionGitStatus | null, hasSession = true) =>
  quickActions(status, hasSession).map((action) => action.id);

describe('一轮结束后的快捷操作', () => {
  it('无会话时不出任何按钮', () => {
    expect(ids(git({ dirty: true, currentBranch: 'feature' }), false)).toEqual([]);
    expect(ids(null, false)).toEqual([]);
  });

  it('非 git 或读不到状态时只有启动服务', () => {
    expect(ids(null)).toEqual(['runServer']);
    expect(ids(git({ currentBranch: null, dirty: true }))).toEqual(['runServer']);
  });

  it('干净且在默认分支时只有启动服务', () => {
    expect(ids(git())).toEqual(['runServer']);
  });

  it('有改动时提交排在最前', () => {
    expect(ids(git({ dirty: true }))).toEqual(['commit', 'runServer']);
    expect(ids(git({ dirty: true, currentBranch: 'feature' }))).toEqual([
      'commit',
      'pr',
      'runServer',
    ]);
  });

  it('在特性分支时出现创建 PR', () => {
    expect(ids(git({ currentBranch: 'feature' }))).toEqual(['pr', 'runServer']);
  });

  it('默认分支未知时不出创建 PR', () => {
    expect(ids(git({ currentBranch: 'feature', defaultBranch: null }))).toEqual(['runServer']);
    expect(ids(git({ currentBranch: 'feature', defaultBranch: undefined }))).toEqual(['runServer']);
  });

  it('dirty 缺省按干净处理', () => {
    expect(ids(git({ dirty: undefined }))).toEqual(['runServer']);
  });

  it('发送文本足够短，且启动服务明确要求后台运行', () => {
    const actions = quickActions(git({ dirty: true, currentBranch: 'feature' }), true);
    expect(actions.map((action) => action.prompt)).toEqual([
      'commit your changes',
      'create a PR',
      'start the dev server in the background',
    ]);
  });
});
