/**
 * 直连 vs 中继的端到端 RTT 比较。中继 WebSocket ping 只到边缘、不能拿来比；
 * 这里的 relayMs 必须是经中继转发的业务 probe 往返。
 * 要同时满足绝对差和相对差，避免几十毫秒噪声来回切。
 */

const MIN_DELTA_MS = 40;
const MIN_RATIO = 1.25;

/** 测速窗口：等 DC pong 与中继 probe-ack；超时仍切直连（兼容旧 host） */
export const DIRECT_QUALITY_TIMEOUT_MS = 1_000;

export function shouldPreferRelay(directMs: number, relayMs: number): boolean {
  if (!Number.isFinite(directMs) || !Number.isFinite(relayMs)) return false;
  if (directMs < 0 || relayMs < 0) return false;
  return directMs >= relayMs + MIN_DELTA_MS && directMs >= relayMs * MIN_RATIO;
}
