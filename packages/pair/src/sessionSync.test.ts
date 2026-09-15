import { describe, expect, it } from 'vitest';
import { isPairSyncCursor, parsePairSessionSync } from './sessionSync';

const snapshot = {
  type: 'snapshot',
  sessions: [
    {
      sessionId: 'session-1',
      identity: { sessionId: 'session-1', generation: 'generation-1' },
      status: 'idle',
      messages: [{ role: 'user', content: [] }],
      baseIndex: 4,
    },
  ],
};

describe('PairSyncCursor', () => {
  it('只接受有界 epoch 与非负安全整数 seq', () => {
    expect(isPairSyncCursor({ epoch: 'epoch-1', seq: 0 })).toBe(true);
    for (const value of [
      null,
      { epoch: '', seq: 0 },
      { epoch: 'x'.repeat(513), seq: 0 },
      { epoch: 'e', seq: -1 },
      { epoch: 'e', seq: 1.5 },
      { epoch: 'e', seq: Number.MAX_SAFE_INTEGER + 1 },
      { epoch: 'e', seq: 0, extra: true },
    ]) {
      expect(isPairSyncCursor(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe('session-sync 下行收窄', () => {
  it('接受单会话 snapshot，并保留协议类型', () => {
    const value = {
      type: 'session-sync',
      sessionId: 'session-1',
      requestId: 'request-1',
      cursor: { epoch: 'epoch-1', seq: 0 },
      mode: 'snapshot',
      snapshot,
    };
    expect(parsePairSessionSync(value)).toEqual(value);
  });

  it('接受连续 replay，含零变化完成帧', () => {
    const replay = {
      type: 'session-sync',
      sessionId: 'session-1',
      requestId: 'request-1',
      cursor: { epoch: 'epoch-1', seq: 2 },
      mode: 'replay',
      fromSeq: 1,
      events: [{ type: 'status', sessionId: 'session-1', status: 'idle' }],
    };
    expect(parsePairSessionSync(replay)).toEqual(replay);
    expect(parsePairSessionSync({ ...replay, fromSeq: 2, events: [] })).not.toBeNull();
  });

  it('拒绝 snapshot 形状或会话身份不一致', () => {
    const base = {
      type: 'session-sync',
      sessionId: 'session-1',
      requestId: 'request-1',
      cursor: { epoch: 'epoch-1', seq: 0 },
      mode: 'snapshot',
    };
    const badSnapshots = [
      null,
      { type: 'other', sessions: snapshot.sessions },
      { type: 'snapshot', sessions: [] },
      { type: 'snapshot', sessions: [...snapshot.sessions, ...snapshot.sessions] },
      { type: 'snapshot', sessions: [{ ...snapshot.sessions[0], sessionId: 'other' }] },
      {
        type: 'snapshot',
        sessions: [
          { ...snapshot.sessions[0], identity: { sessionId: 'other', generation: 'generation-1' } },
        ],
      },
      { type: 'snapshot', sessions: [{ ...snapshot.sessions[0], messages: 'bad' }] },
      { type: 'snapshot', sessions: [{ ...snapshot.sessions[0], baseIndex: -1 }] },
      { type: 'snapshot', sessions: [{ ...snapshot.sessions[0], baseIndex: 1.5 }] },
    ];
    for (const bad of badSnapshots) {
      expect(parsePairSessionSync({ ...base, snapshot: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it('拒绝不连续、非对象或跨会话 replay 事件', () => {
    const base = {
      type: 'session-sync',
      sessionId: 'session-1',
      requestId: 'request-1',
      cursor: { epoch: 'epoch-1', seq: 2 },
      mode: 'replay',
      fromSeq: 1,
    };
    for (const events of [
      [],
      [null],
      [['array']],
      [{ type: 'status' }],
      [{ type: 'status', sessionId: 'other' }],
    ]) {
      expect(parsePairSessionSync({ ...base, events }), JSON.stringify(events)).toBeNull();
    }
    expect(parsePairSessionSync({ ...base, fromSeq: -1, events: [] })).toBeNull();
    expect(parsePairSessionSync({ ...base, fromSeq: 1.5, events: [] })).toBeNull();
    expect(parsePairSessionSync({ ...base, fromSeq: 3, events: [] })).toBeNull();
  });

  it('拒绝空/超长身份、非法 cursor 与分支脏字段', () => {
    const base = {
      type: 'session-sync',
      sessionId: 'session-1',
      requestId: 'request-1',
      cursor: { epoch: 'epoch-1', seq: 0 },
      mode: 'snapshot',
      snapshot,
    };
    for (const value of [
      { ...base, sessionId: '' },
      { ...base, requestId: 'x'.repeat(513) },
      { ...base, cursor: { epoch: 'epoch-1', seq: -1 } },
      { ...base, events: [] },
      { ...base, extra: true },
      { ...base, mode: 'unknown' },
    ]) {
      expect(parsePairSessionSync(value), JSON.stringify(value)).toBeNull();
    }
  });
});
