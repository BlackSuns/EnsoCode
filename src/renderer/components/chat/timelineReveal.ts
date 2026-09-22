/** Virtuoso 初始 LAST 定位期间隐藏正文的上限。定位卡住时不能留白一整秒。 */
export const TIMELINE_REVEAL_CAP_MS = 100;

/**
 * 隐藏起点钉在本次挂载的第一次 hidden。Virtuoso 每次重渲染都会重发 props，
 * visibility 可能在定位成功后再次变成 hidden；若这时重计 1 秒，正文会一直不出现。
 */
export function nextTimelineReveal(
  now: number,
  hiddenSince: number | null,
  hidden: boolean,
  revealed: boolean,
  capMs = TIMELINE_REVEAL_CAP_MS
): { hiddenSince: number | null; delayMs: number | null } {
  if (revealed || !hidden) return { hiddenSince, delayMs: null };
  const started = hiddenSince ?? now;
  return { hiddenSince: started, delayMs: Math.max(0, capMs - (now - started)) };
}
