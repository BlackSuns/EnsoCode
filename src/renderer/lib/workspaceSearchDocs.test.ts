import { describe, expect, it } from 'vitest';
import { isDraftEmptyConversation, recentConversations } from './workspaceSearchDocs';

const conv = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  projectId: 'p1',
  started: true,
  createdAt: 0,
  messages: [] as { timestamp?: number }[],
  ...overrides,
});

describe('isDraftEmptyConversation', () => {
  it('重启后恢复、正文尚未加载的会话（有 sessionFile）不是空草稿', () => {
    expect(isDraftEmptyConversation(conv('c', { started: false, sessionFile: '/s.jsonl' }))).toBe(
      false
    );
  });

  it('未启动、无 sessionFile、无消息才是空草稿', () => {
    expect(isDraftEmptyConversation(conv('c', { started: false }))).toBe(true);
  });
});

describe('recentConversations', () => {
  const options = { scope: 'project' as const, currentProjectId: 'p1' };

  it('包含重启后恢复的会话，按最后活跃时间倒序', () => {
    const list = [
      conv('old', { lastActiveAt: 10 }),
      conv('restored', { started: false, sessionFile: '/s.jsonl', lastActiveAt: 30 }),
      conv('live', { messages: [{ timestamp: 20 }] }),
    ];
    expect(recentConversations(list, options).map((c) => c.id)).toEqual([
      'restored',
      'live',
      'old',
    ]);
  });

  it('排除空草稿、子会话、其他项目和归档；含归档范围才列归档', () => {
    const list = [
      conv('draft', { started: false }),
      conv('child', { parentId: 'root' }),
      conv('other', { projectId: 'p2' }),
      conv('archived', { archived: true }),
      conv('root'),
    ];
    expect(recentConversations(list, options).map((c) => c.id)).toEqual(['root']);
    expect(
      recentConversations(list, { ...options, scope: 'all-including-archived' }).map((c) => c.id)
    ).toEqual(['other', 'archived', 'root']);
  });

  it('默认最多 8 条', () => {
    const list = Array.from({ length: 12 }, (_, index) => conv(`c${index}`));
    expect(recentConversations(list, options)).toHaveLength(8);
  });
});
