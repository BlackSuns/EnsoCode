import { describe, expect, it } from 'vitest';
import { nextTimelineReveal, TIMELINE_REVEAL_CAP_MS } from './timelineReveal';

describe('nextTimelineReveal', () => {
  it('第一次隐藏按上限计时', () => {
    expect(nextTimelineReveal(1_000, null, true, false)).toEqual({
      hiddenSince: 1_000,
      delayMs: TIMELINE_REVEAL_CAP_MS,
    });
  });

  it('visibility 来回切换不重置起点', () => {
    const started = nextTimelineReveal(1_000, null, true, false);
    const visible = nextTimelineReveal(1_000 + 40, started.hiddenSince, false, false);
    expect(visible).toEqual({ hiddenSince: 1_000, delayMs: null });
    expect(nextTimelineReveal(1_000 + 40, visible.hiddenSince, true, false)).toEqual({
      hiddenSince: 1_000,
      delayMs: TIMELINE_REVEAL_CAP_MS - 40,
    });
  });

  it('超过上限后再被藏起来也立刻显示', () => {
    expect(nextTimelineReveal(2_500, 1_000, true, false)).toEqual({
      hiddenSince: 1_000,
      delayMs: 0,
    });
  });

  it('已经放开或当前可见时不再计时', () => {
    expect(nextTimelineReveal(1_500, 1_000, true, true)).toEqual({
      hiddenSince: 1_000,
      delayMs: null,
    });
    expect(nextTimelineReveal(1_500, null, false, false)).toEqual({
      hiddenSince: null,
      delayMs: null,
    });
  });
});
