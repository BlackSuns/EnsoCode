import { describe, expect, it } from 'vitest';
import { shouldFollowTaskBarOutput } from './taskBarScroll';

describe('shouldFollowTaskBarOutput', () => {
  it('仅在用户仍靠近底部时继续跟随', () => {
    expect(
      shouldFollowTaskBarOutput({ scrollHeight: 1000, scrollTop: 580, clientHeight: 400 })
    ).toBe(true);
    expect(
      shouldFollowTaskBarOutput({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })
    ).toBe(false);
  });
});
