import { formatRttMs } from '@shared/pair/rtt';

export function formatOnlineConnectionLabel(
  transport: 'relay' | 'direct',
  rttMs: number | null
): string {
  const via = transport === 'direct' ? '直连' : '中继';
  const rtt = formatRttMs(rttMs);
  return rtt ? `已连接 · ${via} · ${rtt}` : `已连接 · ${via}`;
}
