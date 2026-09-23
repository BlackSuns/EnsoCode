import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachHeartbeat } from './heartbeat';

class FakeWs extends EventTarget {
  readyState = 1;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}

describe('attachHeartbeat RTT', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });
  afterEach(() => vi.useRealTimers());

  it('pong 回报从 ping 发出起的往返时延', () => {
    const ws = new FakeWs();
    const rtts: number[] = [];
    attachHeartbeat(
      ws as unknown as WebSocket,
      () => {},
      (ms) => rtts.push(ms)
    );
    expect(ws.sent).toEqual(['ping']);

    vi.setSystemTime(1_048);
    ws.dispatchEvent(Object.assign(new Event('message'), { data: 'pong' }));
    expect(rtts).toEqual([48]);
  });

  it('业务帧不算 RTT', () => {
    const ws = new FakeWs();
    const rtts: number[] = [];
    attachHeartbeat(
      ws as unknown as WebSocket,
      () => {},
      (ms) => rtts.push(ms)
    );
    vi.setSystemTime(1_020);
    ws.dispatchEvent(Object.assign(new Event('message'), { data: new ArrayBuffer(4) }));
    expect(rtts).toEqual([]);
  });
});
