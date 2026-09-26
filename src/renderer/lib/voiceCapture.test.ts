import { describe, expect, it } from 'vitest';
import { downsampleTo16k, joinChunks } from './voiceCapture';

describe('downsampleTo16k', () => {
  it('returns 16kHz input unchanged', () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    expect(downsampleTo16k(input, 16_000)).toBe(input);
  });

  it('averages each output window so 48kHz shrinks to a third', () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect(Array.from(downsampleTo16k(input, 48_000))).toEqual([expect.closeTo(0.3, 5), 1, -1]);
  });

  it('handles non-integer ratios such as 44.1kHz without drifting in length', () => {
    const input = new Float32Array(44_100).fill(0.5);
    const output = downsampleTo16k(input, 44_100);
    expect(output.length).toBe(16_000);
    expect(output.every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });
});

describe('joinChunks', () => {
  it('concatenates recorded buffers in order', () => {
    expect(Array.from(joinChunks([Float32Array.from([1, 2]), Float32Array.from([3])]))).toEqual([
      1, 2, 3,
    ]);
  });
});
