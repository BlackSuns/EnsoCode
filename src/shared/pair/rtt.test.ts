import { describe, expect, it } from 'vitest';
import { formatRttMs } from './rtt';

describe('formatRttMs', () => {
  it('无采样或非法值不显示', () => {
    expect(formatRttMs(null)).toBeNull();
    expect(formatRttMs(undefined)).toBeNull();
    expect(formatRttMs(Number.NaN)).toBeNull();
    expect(formatRttMs(-1)).toBeNull();
  });

  it('四舍五入为毫秒', () => {
    expect(formatRttMs(32)).toBe('32ms');
    expect(formatRttMs(180.4)).toBe('180ms');
  });

  it('不足 1ms 显示 <1ms', () => {
    expect(formatRttMs(0)).toBe('<1ms');
    expect(formatRttMs(0.2)).toBe('<1ms');
  });
});
