import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay } from './relay';

describe('backoffDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('首次重连不等待', () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(-1)).toBe(0);
  });

  it('之后按 1s、2s、4s 指数退避，带抖动、上限 30s', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(backoffDelay(1)).toBe(1_000);
    expect(backoffDelay(2)).toBe(2_000);
    expect(backoffDelay(3)).toBe(4_000);
    expect(backoffDelay(10)).toBe(30_000);
  });
});
