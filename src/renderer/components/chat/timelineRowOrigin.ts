/** 不知道全文行数时用一个足够大的原点，前置只按实际新增行数下移。 */
export const TIMELINE_ROW_INDEX_BASE = 1_000_000;

export interface TimelineRowAnchor {
  key: string;
  index: number;
}

/**
 * Virtuoso 的 firstItemIndex 差值必须等于前置的行数，不能用消息绝对下标。
 * 旧首行消失（尾窗被全量换掉）时重挂，让列表重新贴底。
 */
export function nextTimelineRowOrigin(
  previous: TimelineRowAnchor | null,
  keys: readonly string[],
  base = TIMELINE_ROW_INDEX_BASE
): { anchor: TimelineRowAnchor | null; firstItemIndex: number; remount: boolean } {
  const firstKey = keys[0];
  if (!firstKey) return { anchor: null, firstItemIndex: base, remount: false };
  if (!previous) {
    return { anchor: { key: firstKey, index: base }, firstItemIndex: base, remount: false };
  }
  const at = keys.indexOf(previous.key);
  if (at < 0) {
    return { anchor: { key: firstKey, index: base }, firstItemIndex: base, remount: true };
  }
  const firstItemIndex = previous.index - at;
  return {
    anchor: { key: firstKey, index: firstItemIndex },
    firstItemIndex,
    remount: false,
  };
}
