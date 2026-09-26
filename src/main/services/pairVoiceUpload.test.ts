import { encodeVoiceChunks } from '@enso/pair';
import { describe, expect, it } from 'vitest';
import { VoiceUploads } from './pairVoiceUpload';

const chunks = (values: number[], size: number) =>
  encodeVoiceChunks(new Float32Array(values), size);
const chunk = (requestId: string, index: number, data: string, last?: boolean) => ({
  requestId,
  index,
  data,
  ...(last ? { last: true as const } : {}),
});

describe('手机语音分块拼包', () => {
  it('顺序到齐后交付 Float32（Int16/32768）', () => {
    const up = new VoiceUploads();
    const [a, b] = chunks([0.5, -0.5, 0.25], 2);
    expect(up.accept(chunk('r', 0, a), 0)).toBeNull();
    const done = up.accept(chunk('r', 1, b, true), 0);
    expect(done?.kind).toBe('complete');
    if (done?.kind !== 'complete') return;
    expect(done.requestId).toBe('r');
    expect(Array.from(done.samples)).toEqual([16384 / 32768, -16384 / 32768, 8192 / 32768]);
  });

  it('乱序（末块先到）按 index 拼回', () => {
    const up = new VoiceUploads();
    const [a, b, c] = chunks([0.5, 0.25, -0.5], 1);
    expect(up.accept(chunk('r', 2, c, true), 0)).toBeNull();
    expect(up.accept(chunk('r', 0, a), 0)).toBeNull();
    const done = up.accept(chunk('r', 1, b), 0);
    expect(done?.kind === 'complete' && Array.from(done.samples)).toEqual([0.5, 0.25, -0.5]);
  });

  it('非法数据报 invalid-audio，同 id 后续分块忽略且不占名额', () => {
    const up = new VoiceUploads({ maxActive: 1 });
    const [a] = chunks([0.1], 1);
    expect(up.accept(chunk('r', 0, 'AA'), 0)).toEqual({
      kind: 'error',
      requestId: 'r',
      error: 'invalid-audio',
    });
    expect(up.accept(chunk('r', 1, a, true), 0)).toBeNull();
    expect(up.accept(chunk('s', 0, a, true), 0)?.kind).toBe('complete');
  });

  it('重复 index、越过总数、末块与已有 index 矛盾均报错', () => {
    const [a] = chunks([0.1], 1);
    const dup = new VoiceUploads();
    dup.accept(chunk('r', 0, a), 0);
    expect(dup.accept(chunk('r', 0, a), 0)?.kind).toBe('error');

    const beyond = new VoiceUploads();
    beyond.accept(chunk('r', 1, a, true), 0);
    expect(beyond.accept(chunk('r', 2, a), 0)?.kind).toBe('error');

    const early = new VoiceUploads();
    early.accept(chunk('r', 3, a), 0);
    expect(early.accept(chunk('r', 1, a, true), 0)?.kind).toBe('error');

    const twoLast = new VoiceUploads();
    twoLast.accept(chunk('r', 2, a, true), 0);
    expect(twoLast.accept(chunk('r', 1, a, true), 0)?.kind).toBe('error');
  });

  it('累计采样超上限报 invalid-audio', () => {
    const up = new VoiceUploads({ maxSamples: 3 });
    const [a, b] = chunks([0, 0, 0, 0], 2);
    expect(up.accept(chunk('r', 0, a), 0)).toBeNull();
    expect(up.accept(chunk('r', 1, b, true), 0)).toEqual({
      kind: 'error',
      requestId: 'r',
      error: 'invalid-audio',
    });
  });

  it('同时进行的上传超过上限报 failed，完成后释放名额', () => {
    const up = new VoiceUploads();
    const [a] = chunks([0.1], 1);
    up.accept(chunk('r1', 0, a), 0);
    up.accept(chunk('r2', 0, a), 0);
    expect(up.accept(chunk('r3', 0, a), 0)).toEqual({
      kind: 'error',
      requestId: 'r3',
      error: 'failed',
    });
    expect(up.accept(chunk('r1', 1, a, true), 0)?.kind).toBe('complete');
    expect(up.accept(chunk('r4', 0, a, true), 0)?.kind).toBe('complete');
  });

  it('超时未完成的上传被丢弃，迟到分块忽略', () => {
    const up = new VoiceUploads({ maxActive: 1, ttlMs: 1000 });
    const [a] = chunks([0.1], 1);
    up.accept(chunk('old', 0, a), 0);
    expect(up.accept(chunk('new', 0, a, true), 1001)?.kind).toBe('complete');
    expect(up.accept(chunk('old', 1, a, true), 1002)).toBeNull();
  });

  it('clear 丢弃所有进行中的上传', () => {
    const up = new VoiceUploads({ maxActive: 1 });
    const [a] = chunks([0.1], 1);
    up.accept(chunk('r', 0, a), 0);
    up.clear();
    expect(up.accept(chunk('s', 0, a, true), 0)?.kind).toBe('complete');
  });
});
