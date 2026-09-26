import { describe, expect, it } from 'vitest';
import { createDownsampler, levelFromSamples } from './voiceCapture';

function feed(input: Float32Array, rate: number, sizes: number[]): number[] {
  const downsample = createDownsampler(rate);
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; offset < input.length; i++) {
    const size = sizes[i % sizes.length];
    out.push(...downsample(input.subarray(offset, offset + size)));
    offset += size;
  }
  return out;
}

describe('createDownsampler', () => {
  it('passes 16kHz chunks through untouched', () => {
    const chunk = Float32Array.from([0.1, -0.2, 0.3]);
    expect(createDownsampler(16_000)(chunk)).toBe(chunk);
  });

  it('averages each output window so 48kHz shrinks to a third', () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1, -1, -1, -1]);
    expect(feed(input, 48_000, [9])).toEqual([expect.closeTo(0.3, 5), 1, -1]);
  });

  it('carries windows across chunk boundaries without losing or duplicating samples', () => {
    const input = Float32Array.from({ length: 4_410 }, (_, i) => Math.sin(i / 7));
    const whole = feed(input, 44_100, [input.length]);
    expect(whole.length).toBe(1_600);
    const ragged = feed(input, 44_100, [1, 4096, 13, 250]);
    expect(ragged.length).toBe(whole.length);
    for (const [i, sample] of ragged.entries()) expect(sample).toBeCloseTo(whole[i], 6);
  });

  it('keeps a constant signal constant at non-integer ratios', () => {
    const out = feed(new Float32Array(44_100).fill(0.5), 44_100, [4096]);
    expect(out.length).toBe(16_000);
    expect(out.every((sample) => Math.abs(sample - 0.5) < 1e-6)).toBe(true);
  });
});

describe('levelFromSamples', () => {
  it('is 0 for silence and 1 for a full-scale signal', () => {
    expect(levelFromSamples(new Float32Array(1024))).toBe(0);
    expect(levelFromSamples(new Float32Array(0))).toBe(0);
    expect(levelFromSamples(new Float32Array(1024).fill(1))).toBe(1);
  });

  it('keeps background noise low and normal speech clearly visible', () => {
    const noise = levelFromSamples(new Float32Array(1024).fill(0.002));
    const speech = levelFromSamples(new Float32Array(1024).fill(0.08));
    expect(noise).toBeLessThan(0.1);
    expect(speech).toBeGreaterThan(0.6);
    expect(speech).toBeLessThan(1);
  });

  it('grows with loudness', () => {
    const levels = [0.005, 0.02, 0.1].map((v) => levelFromSamples(new Float32Array(512).fill(v)));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(3);
  });
});
