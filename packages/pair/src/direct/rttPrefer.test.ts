import { describe, expect, it } from 'vitest';
import { shouldPreferRelay } from './rttPrefer';

describe('shouldPreferRelay', () => {
  it('直连明显更慢时回退中继', () => {
    expect(shouldPreferRelay(120, 40)).toBe(true);
    expect(shouldPreferRelay(80, 20)).toBe(true);
  });

  it('差距在噪声范围内仍走直连', () => {
    expect(shouldPreferRelay(55, 50)).toBe(false);
    expect(shouldPreferRelay(70, 50)).toBe(false);
    expect(shouldPreferRelay(40, 40)).toBe(false);
    expect(shouldPreferRelay(20, 80)).toBe(false);
  });

  it('脏输入不回退', () => {
    expect(shouldPreferRelay(Number.NaN, 40)).toBe(false);
    expect(shouldPreferRelay(120, Number.POSITIVE_INFINITY)).toBe(false);
    expect(shouldPreferRelay(-1, 40)).toBe(false);
    expect(shouldPreferRelay(120, -5)).toBe(false);
  });
});
