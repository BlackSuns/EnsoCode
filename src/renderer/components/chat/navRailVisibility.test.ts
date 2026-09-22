import { describe, expect, it } from 'vitest';
import { navRailEnabled } from './navRailVisibility';

describe('navRailEnabled', () => {
  it('阅读宽度且至少两轮时显示', () => {
    expect(navRailEnabled(false, 2)).toBe(true);
  });

  it('铺满宽度时不显示，避免感应带盖住左缘正文', () => {
    expect(navRailEnabled(true, 8)).toBe(false);
  });

  it('不足两轮时没有可跳目标', () => {
    expect(navRailEnabled(false, 1)).toBe(false);
    expect(navRailEnabled(false, 0)).toBe(false);
  });
});
