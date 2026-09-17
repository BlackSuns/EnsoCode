import {
  type AutoRestartIdleSnapshot,
  idleDurationMs,
  isAutoRestartBlocked,
  nextIdleSince,
  remainingIdleMs,
  shouldAutoRestartForUpdate,
} from '@shared/updater/idleRestart';

export type IdleRestartObservation = Omit<AutoRestartIdleSnapshot, 'idleForMs'>;

/** 跟踪连续空闲；quitAndInstall 失败后不再自动重试。 */
export class IdleRestartGate {
  private idleSince: number | null = null;
  private failed = false;

  evaluate(observation: IdleRestartObservation, now: number): boolean {
    if (this.failed) return false;
    const blocked = isAutoRestartBlocked(observation);
    this.idleSince = nextIdleSince(this.idleSince, blocked, now);
    return shouldAutoRestartForUpdate({
      ...observation,
      idleForMs: idleDurationMs(this.idleSince, now),
    });
  }

  markFailed(): void {
    this.failed = true;
    this.idleSince = null;
  }

  reset(): void {
    this.idleSince = null;
    this.failed = false;
  }

  delayUntilReadyMs(now: number): number | null {
    if (this.failed) return null;
    return remainingIdleMs(this.idleSince, now);
  }

  isFailed(): boolean {
    return this.failed;
  }
}
