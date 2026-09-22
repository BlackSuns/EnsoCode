import { describe, expect, it } from 'vitest';
import { shouldFocusChildReservation } from './childReservationFocus';

const base = {
  manual: true,
  activeId: 'parent',
  parentId: 'parent',
  childId: 'child-2',
  activeTabId: undefined,
  tabExists: false,
};

describe('shouldFocusChildReservation', () => {
  it('手动派发且正停在父会话时聚焦新 child', () => {
    expect(shouldFocusChildReservation(base)).toBe(true);
  });

  it('后台预约、已经离开父会话、或正读着另一个 child 时不抢焦点', () => {
    expect(shouldFocusChildReservation({ ...base, manual: false })).toBe(false);
    expect(shouldFocusChildReservation({ ...base, activeId: 'other' })).toBe(false);
    expect(
      shouldFocusChildReservation({
        ...base,
        activeTabId: 'child-1',
        tabExists: true,
      })
    ).toBe(false);
  });
});
