/** 只有本窗口刚刚手动派发、并且人还停在这个父会话上，才把焦点交给新 child。 */
export function shouldFocusChildReservation(input: {
  manual: boolean;
  activeId: string | null;
  parentId: string;
  childId: string;
  activeTabId?: string;
  tabExists: boolean;
}): boolean {
  if (!input.manual || input.activeId !== input.parentId) return false;
  const tab = input.activeTabId;
  if (tab && tab !== input.parentId && tab !== input.childId && input.tabExists) return false;
  return true;
}
