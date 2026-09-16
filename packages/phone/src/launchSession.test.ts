import { describe, expect, it } from 'vitest';
import {
  LAUNCH_SESSION_CACHE,
  LAUNCH_SESSION_URL,
  parseSessionFromSearch,
  parseSessionId,
  takeStashedSessionId,
} from './launchSession';

describe('parseSessionId', () => {
  it('接受 uuid 与 coworker id', () => {
    expect(parseSessionId('s1')).toBe('s1');
    expect(parseSessionId('  abc-def  ')).toBe('abc-def');
    expect(parseSessionId('s1::cw-bob')).toBe('s1::cw-bob');
  });

  it('拒绝空值、过长和路径/查询注入', () => {
    expect(parseSessionId(null)).toBeNull();
    expect(parseSessionId(1)).toBeNull();
    expect(parseSessionId('')).toBeNull();
    expect(parseSessionId('   ')).toBeNull();
    expect(parseSessionId('a'.repeat(201))).toBeNull();
    expect(parseSessionId('../etc/passwd')).toBeNull();
    expect(parseSessionId('s1?x=1')).toBeNull();
    expect(parseSessionId('javascript:alert(1)')).toBeNull();
  });
});

describe('parseSessionFromSearch', () => {
  it('从 query 取出 session 并解码', () => {
    expect(parseSessionFromSearch('?session=s1')).toBe('s1');
    expect(parseSessionFromSearch('session=s1&foo=1')).toBe('s1');
    expect(parseSessionFromSearch('?foo=1&session=s1%3A%3Acw-bob')).toBe('s1::cw-bob');
  });

  it('缺省或脏 session 返回 null', () => {
    expect(parseSessionFromSearch('')).toBeNull();
    expect(parseSessionFromSearch('?foo=1')).toBeNull();
    expect(parseSessionFromSearch('?session=')).toBeNull();
    expect(parseSessionFromSearch('?session=../x')).toBeNull();
  });
});

describe('takeStashedSessionId', () => {
  it('读出后删除 stash；非法 id 丢弃', async () => {
    const store = new Map<string, string>();
    const open = async () => ({
      match: async (url: RequestInfo) => {
        const value = store.get(String(url));
        return value === undefined ? undefined : new Response(value);
      },
      delete: async (url: RequestInfo) => store.delete(String(url)),
    });
    const cachesApi = { open };

    store.set(LAUNCH_SESSION_URL, 's1::cw-bob');
    expect(await takeStashedSessionId(cachesApi)).toBe('s1::cw-bob');
    expect(store.size).toBe(0);

    store.set(LAUNCH_SESSION_URL, '../nope');
    expect(await takeStashedSessionId(cachesApi)).toBeNull();
    expect(store.size).toBe(0);

    expect(await takeStashedSessionId(cachesApi)).toBeNull();
    expect(LAUNCH_SESSION_CACHE).toBe('enso-phone-launch');
  });
});
