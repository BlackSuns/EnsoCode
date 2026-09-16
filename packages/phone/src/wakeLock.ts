/** 前台当第二屏：有运行中或待你动手时挡住熄屏；API 缺失则静默。 */

export function shouldHoldWakeLock(
  visible: boolean,
  entries: readonly {
    status?: string;
    pendingAskCount?: number;
    pendingApprovalCount?: number;
  }[]
): boolean {
  if (!visible) return false;
  return entries.some(
    (entry) =>
      entry.status === 'running' ||
      (typeof entry.pendingAskCount === 'number' && entry.pendingAskCount > 0) ||
      (typeof entry.pendingApprovalCount === 'number' && entry.pendingApprovalCount > 0)
  );
}

type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};

type WakeLockLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
};

let sentinel: WakeLockSentinelLike | null = null;

export async function syncWakeLock(
  hold: boolean,
  wakeLock: WakeLockLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
): Promise<void> {
  if (!hold || !wakeLock) {
    if (!sentinel) return;
    const current = sentinel;
    sentinel = null;
    try {
      await current.release();
    } catch {}
    return;
  }
  if (sentinel) return;
  try {
    const next = await wakeLock.request('screen');
    sentinel = next;
    next.addEventListener('release', () => {
      if (sentinel === next) sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}
