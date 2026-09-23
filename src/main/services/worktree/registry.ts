/**
 * 会话 ↔ worktree 绑定的持久化注册表（main 权威）。
 * spawn cwd 授权（ipc/agent.ts persistedRootSpawn）依赖此表判断 worktree 路径合法性。
 * 单文件 JSON（userData/worktrees.json），量小，原子替换落盘 + Main 唯一内存缓存。
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionWorktree, WorktreeUsageRecord } from '../../../shared/types/worktree';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSessionWorktree(value: unknown): value is SessionWorktree {
  return (
    isObject(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.repoPath === 'string' &&
    typeof value.path === 'string' &&
    typeof value.branch === 'string' &&
    (typeof value.baseBranch === 'string' || value.baseBranch === null) &&
    typeof value.baseCommit === 'string' &&
    typeof value.createdAt === 'number'
  );
}

let sharedRegistry: { filePath: string; value: WorktreeRegistry } | undefined;

export function getSharedWorktreeRegistry(filePath: string): WorktreeRegistry {
  if (sharedRegistry && sharedRegistry.filePath !== filePath) {
    throw new Error('Main worktree registry is already initialized with another path');
  }
  sharedRegistry ??= { filePath, value: new WorktreeRegistry(filePath) };
  return sharedRegistry.value;
}

export class WorktreeRegistry {
  private records = new Map<string, SessionWorktree>();
  constructor(private readonly filePath: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (isSessionWorktree(value)) {
            const name = typeof value.name === 'string' ? value.name.trim() : '';
            this.records.set(id, {
              ...value,
              name: name && name.length <= 80 ? name : undefined,
            });
          }
        }
      }
    } catch {
      // 文件不存在或损坏：当空库
    }
  }

  get(conversationId: string): SessionWorktree | undefined {
    return this.records.get(conversationId);
  }

  set(record: SessionWorktree): void {
    this.records.set(record.conversationId, record);
    this.flush();
  }

  usageRecords(): WorktreeUsageRecord[] {
    return [...this.records.values()].map(({ path, projectId, repoPath }) => ({
      path,
      projectId,
      repoPath,
    }));
  }

  share(fromConversationId: string, toConversationId: string): void {
    const source = this.records.get(fromConversationId);
    if (!source) return;
    const previous = this.records.get(toConversationId);
    this.records.set(toConversationId, { ...source, conversationId: toConversationId });
    try {
      this.flush();
    } catch (error) {
      if (previous) this.records.set(toConversationId, previous);
      else this.records.delete(toConversationId);
      throw error;
    }
  }

  bindings(record: SessionWorktree): SessionWorktree[] {
    return this.list(record.projectId).filter(
      (candidate) => candidate.repoPath === record.repoPath && candidate.path === record.path
    );
  }

  replaceBindings(previous: SessionWorktree, replacement: SessionWorktree): SessionWorktree[] {
    const bindings = this.bindings(previous);
    const updated = bindings.map((record) => ({
      ...replacement,
      conversationId: record.conversationId,
    }));
    for (const record of updated) this.records.set(record.conversationId, record);
    try {
      this.flush();
    } catch (error) {
      for (const record of bindings) this.records.set(record.conversationId, record);
      throw error;
    }
    return updated;
  }

  /** Git 已切换：落盘失败也保留内存中的真实分支，不回滚文件系统事实。 */
  updateBranches(conversationIds: string[], branch: string): SessionWorktree[] {
    const updated = conversationIds.flatMap((id) => {
      const record = this.records.get(id);
      return record ? [{ ...record, branch }] : [];
    });
    for (const record of updated) this.records.set(record.conversationId, record);
    if (updated.length) this.flush();
    return updated;
  }

  rename(conversationId: string, value: string): SessionWorktree[] {
    const record = this.get(conversationId);
    if (!record) throw new Error('no worktree for conversation');
    const name = value.trim();
    if (name.length > 80) throw new Error('worktree name must be at most 80 characters');
    return this.replaceBindings(record, { ...record, name: name || undefined });
  }

  delete(conversationId: string): void {
    const previous = this.records.get(conversationId);
    if (!previous) return;
    this.records.delete(conversationId);
    try {
      this.flush();
    } catch (error) {
      this.records.set(conversationId, previous);
      throw error;
    }
  }

  list(projectId?: string): SessionWorktree[] {
    const all = [...this.records.values()];
    return projectId ? all.filter((r) => r.projectId === projectId) : all;
  }

  private flush(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const entries = [...this.records.entries()];
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(entries), null, 2));
      renameSync(temporary, this.filePath);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
}
