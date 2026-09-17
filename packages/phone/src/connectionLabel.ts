export function formatOnlineConnectionLabel(
  transport: 'relay' | 'direct',
  rttMs: number | null
): string {
  const via = transport === 'direct' ? '直连' : '中继';
  if (rttMs == null || !Number.isFinite(rttMs) || rttMs < 0) return `已连接 · ${via}`;
  const n = Math.round(rttMs);
  return `已连接 · ${via} · ${n < 1 ? '<1ms' : `${n}ms`}`;
}
