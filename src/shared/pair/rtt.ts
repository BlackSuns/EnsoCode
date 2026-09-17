/** ping→pong 往返展示；无采样返回 null，调用方保持原标签 */
export function formatRttMs(rttMs: number | null | undefined): string | null {
  if (rttMs == null || !Number.isFinite(rttMs) || rttMs < 0) return null;
  const n = Math.round(rttMs);
  return n < 1 ? '<1ms' : `${n}ms`;
}
