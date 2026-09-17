import { describe, expect, it } from 'vitest';
import { parseAppCloseResponse, shouldBypassCloseConfirm } from './appClose';

describe('shouldBypassCloseConfirm', () => {
  it('blocks the first close or quit', () => {
    expect(shouldBypassCloseConfirm({ allowQuit: false, quittingForUpdate: false })).toBe(false);
  });

  it('skips after the user confirms or an update install starts', () => {
    expect(shouldBypassCloseConfirm({ allowQuit: true, quittingForUpdate: false })).toBe(true);
    expect(shouldBypassCloseConfirm({ allowQuit: false, quittingForUpdate: true })).toBe(true);
  });

  it('skips the destroy used to enter server mode', () => {
    expect(
      shouldBypassCloseConfirm({ allowQuit: false, quittingForUpdate: false, bypassDestroy: true })
    ).toBe(true);
  });
});

describe('parseAppCloseResponse', () => {
  it('accepts only the current request id and a close action', () => {
    expect(parseAppCloseResponse('r1', 'r1', { action: 'quit' })).toEqual({ action: 'quit' });
    expect(parseAppCloseResponse('r1', 'r1', { action: 'tray' })).toEqual({ action: 'tray' });
    expect(parseAppCloseResponse('r1', 'r1', { action: 'cancel' })).toEqual({ action: 'cancel' });
  });

  it('ignores stale or malformed replies', () => {
    expect(parseAppCloseResponse('r1', 'r2', { action: 'quit' })).toBeNull();
    expect(parseAppCloseResponse('r1', 'r1', { action: 'yes' })).toBeNull();
    expect(parseAppCloseResponse('r1', 'r1', { confirmed: true })).toBeNull();
    expect(parseAppCloseResponse('r1', 'r1', null)).toBeNull();
  });
});
