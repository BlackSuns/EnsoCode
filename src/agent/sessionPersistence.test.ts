import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { emptyUsage } from '@shared/providers/piProviderTypes';
import { afterAll, describe, expect, it } from 'vitest';
import { materializeSessionFile, persistRewindLeaf } from './supervisor';

// 真实 SessionManager：这里要验的是磁盘上的可观测结果，mock 掉就失去意义。
const root = mkdtempSync(path.join(tmpdir(), 'enso-session-persist-'));
const sessionDir = path.join(root, 'sessions');
const cwd = path.join(root, 'project');

afterAll(() => rmSync(root, { recursive: true, force: true }));

function sessionWith(manager: SessionManager, messages: unknown[]): AgentSession {
  return { sessionManager: manager, messages } as unknown as AgentSession;
}

function entriesOf(file: string): { type?: string; customType?: string }[] {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function user(text: string): UserMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1,
  };
}

function assistant(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-4',
    usage: emptyUsage(),
    stopReason: 'stop',
    timestamp: 1,
  };
}

function userTexts(manager: SessionManager): string[] {
  const texts: string[] = [];
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'user') continue;
    const { content } = entry.message;
    texts.push(
      Array.isArray(content)
        ? content.map((part) => ('text' in part ? part.text : '')).join('')
        : ''
    );
  }
  return texts;
}

describe('派发父容器的 custom entry 必须能落盘', () => {
  it('没有 assistant 消息时，pi 自己不落盘，materialize 之后文件存在且含该 entry', () => {
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    expect(file).toBeTruthy();
    if (!file) return;

    manager.appendCustomEntry('enso-agent-session', { kind: 'agent-dispatch' });

    // 上游行为基线：pi 的 _persist 在出现第一条 assistant 消息前一个字节都不写。
    // 若哪天 pi 改了这个启发式，这条断言会先飘红，提醒复检本适配层是否还需要。
    expect(existsSync(file)).toBe(false);

    materializeSessionFile(sessionWith(manager, []));

    expect(existsSync(file)).toBe(true);
    const customs = entriesOf(file).filter((entry) => entry.type === 'custom');
    expect(customs).toHaveLength(1);
    expect(customs[0]?.customType).toBe('enso-agent-session');
  });

  it('新会话 materialize 后仍能安全落盘首条 assistant', () => {
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    expect(file).toBeTruthy();
    if (!file) return;

    manager.appendCustomEntry('enso-agent-session', { kind: 'agent-dispatch' });
    materializeSessionFile(sessionWith(manager, []));

    expect(() =>
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'first response' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 0,
      })
    ).not.toThrow();

    expect(entriesOf(file).some((entry) => entry.type === 'message')).toBe(true);
    const reopened = SessionManager.open(file, sessionDir);
    expect(
      reopened
        .getBranch()
        .some((entry) => entry.type === 'message' && entry.message.role === 'assistant')
    ).toBe(true);
  });

  it('多条通知都要在文件里，不能只留第一条', () => {
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    if (!file) return;

    const session = sessionWith(manager, []);
    for (const kind of ['agent-dispatch', 'agent-completed', 'agent-dispatch']) {
      manager.appendCustomEntry('enso-agent-session', { kind });
      materializeSessionFile(session);
    }

    expect(entriesOf(file).filter((entry) => entry.type === 'custom')).toHaveLength(3);
  });

  it('已有 assistant 消息时交还给 pi 自己持久化，不重复介入', () => {
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    if (!file) return;

    // pi 已接管：materialize 不该再强制重写（此处仅断言不抛错、不破坏已有内容）
    materializeSessionFile(sessionWith(manager, [{ role: 'assistant' }]));
    expect(existsSync(file)).toBe(false);
  });
});

describe('回退叶子必须能跨重启恢复', () => {
  it('navigateTree 只改内存时，重开文件会回到回退前的叶子', () => {
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    expect(file).toBeTruthy();
    if (!file) return;
    manager.appendMessage(user('keep'));
    manager.appendMessage(assistant('a'));
    const rewindTarget = manager.appendMessage(user('edit-me'));
    manager.appendMessage(assistant('b'));
    const target = manager.getEntry(rewindTarget);
    expect(target?.parentId).toBeTruthy();
    if (!target?.parentId) return;
    manager.branch(target.parentId);
    const reopened = SessionManager.open(file, sessionDir);
    expect(userTexts(reopened)).toContain('edit-me');
  });

  it('写入 rewind leaf 锚点后，重开会话不再包含被回退的 user', () => {
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    expect(file).toBeTruthy();
    if (!file) return;
    manager.appendMessage(user('keep'));
    manager.appendMessage(assistant('a'));
    const rewindTarget = manager.appendMessage(user('edit-me'));
    manager.appendMessage(assistant('b'));
    const target = manager.getEntry(rewindTarget);
    expect(target?.parentId).toBeTruthy();
    if (!target?.parentId) return;
    manager.branch(target.parentId);
    persistRewindLeaf(sessionWith(manager, [user('keep'), assistant('a')]));
    const reopened = SessionManager.open(file, sessionDir);
    expect(userTexts(reopened)).toEqual(['keep']);
  });
});
