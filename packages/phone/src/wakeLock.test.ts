import { describe, expect, it } from 'vitest';
import { shouldHoldWakeLock } from './wakeLock';

describe('shouldHoldWakeLock', () => {
  it('不可见时不持有', () => {
    expect(shouldHoldWakeLock(false, [{ status: 'running' }])).toBe(false);
    expect(shouldHoldWakeLock(false, [{ status: 'idle', pendingAskCount: 1 }])).toBe(false);
  });

  it('可见且有运行中会话时持有', () => {
    expect(shouldHoldWakeLock(true, [{ status: 'idle' }, { status: 'running' }])).toBe(true);
  });

  it('可见且有待提问或待审批时持有', () => {
    expect(shouldHoldWakeLock(true, [{ status: 'idle', pendingAskCount: 1 }])).toBe(true);
    expect(shouldHoldWakeLock(true, [{ status: 'idle', pendingApprovalCount: 2 }])).toBe(true);
  });

  it('可见但全部空闲则释放', () => {
    expect(shouldHoldWakeLock(true, [])).toBe(false);
    expect(shouldHoldWakeLock(true, [{ status: 'idle' }, { status: 'failed' }])).toBe(false);
  });
});
