import { randomUUID } from 'node:crypto';
import type { PairSyncCursor } from '@enso/pair';
import {
  applyGuestEvent,
  applyGuestSnapshot,
  emptyGuestView,
  type GuestSessionView,
} from '@shared/pair/guestProjection';
import { SNAPSHOT_TAIL_MESSAGES } from '@shared/snapshotTail';

export interface PairReplayLimits {
  maxEventsPerSession: number;
  maxBytesPerSession: number;
  maxSessions: number;
  maxTotalBytes: number;
}

const DEFAULT_LIMITS: PairReplayLimits = {
  maxEventsPerSession: 512,
  maxBytesPerSession: 600_000,
  maxSessions: 64,
  maxTotalBytes: 8_000_000,
};

interface StoredEvent {
  seq: number;
  bytes: number;
  event: Record<string, unknown>;
}

interface SessionLog {
  epoch: string;
  seq: number;
  floorSeq: number;
  bytes: number;
  generation?: string;
  events: StoredEvent[];
  projection?: GuestSessionView;
}

export interface PairReplayRecord {
  sessionId: string;
  cursor: PairSyncCursor;
  event: Record<string, unknown>;
}

export interface PairReplaySlice {
  cursor: PairSyncCursor;
  fromSeq: number;
  events: Record<string, unknown>[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function identityOf(event: Record<string, unknown>): {
  sessionId: string;
  generation?: string;
} | null {
  const identity = isRecord(event.identity) ? event.identity : null;
  const sessionId =
    typeof identity?.sessionId === 'string'
      ? identity.sessionId
      : typeof event.sessionId === 'string'
        ? event.sessionId
        : null;
  if (!sessionId) return null;
  return {
    sessionId,
    ...(typeof identity?.generation === 'string' ? { generation: identity.generation } : {}),
  };
}

const clone = <T>(value: T): T => structuredClone(value);

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function matchesSnapshot(projection: GuestSessionView, incoming: GuestSessionView): boolean {
  if (
    projection.status !== incoming.status ||
    projection.compaction !== incoming.compaction ||
    !sameJson(projection.approvals, incoming.approvals) ||
    !sameJson(projection.asks, incoming.asks) ||
    !sameJson(projection.tasks, incoming.tasks) ||
    !sameJson(projection.subagents, incoming.subagents)
  ) {
    return false;
  }
  const incomingMax = incoming.messages.size ? Math.max(...incoming.messages.keys()) : -1;
  for (const index of projection.messages.keys()) {
    if (index > incomingMax) return false;
  }
  const currentMin = projection.messages.size ? Math.min(...projection.messages.keys()) : null;
  for (const [index, message] of incoming.messages) {
    const current = projection.messages.get(index);
    if (current === undefined) {
      if (currentMin !== null && index < currentMin) continue;
      return false;
    }
    if (!sameJson(current, message)) return false;
  }
  return true;
}

export class PairReplayLog {
  private readonly limits: PairReplayLimits;
  private readonly logs = new Map<string, SessionLog>();
  private totalBytes = 0;

  constructor(
    limits: Partial<PairReplayLimits> = {},
    private readonly epochFactory: () => string = randomUUID
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  resetSession(sessionId: string, generation?: string): PairSyncCursor {
    this.remove(sessionId);
    const log: SessionLog = {
      epoch: this.epochFactory(),
      seq: 0,
      floorSeq: 0,
      bytes: 0,
      ...(generation ? { generation } : {}),
      events: [],
    };
    this.logs.set(sessionId, log);
    this.enforceGlobalLimits(sessionId);
    return { epoch: log.epoch, seq: 0 };
  }

  cursorOf(sessionId: string): PairSyncCursor | null {
    const log = this.logs.get(sessionId);
    return log ? { epoch: log.epoch, seq: log.seq } : null;
  }

  checkpoint(
    sessionId: string,
    snapshot: { sessions?: unknown[] },
    generation?: string
  ): PairSyncCursor {
    let log = this.logs.get(sessionId);
    if (!log || (generation && log.generation && log.generation !== generation)) {
      const cursor = this.resetSession(sessionId, generation);
      log = this.logs.get(sessionId);
      if (log) this.setProjection(log, snapshot, sessionId);
      return cursor;
    }
    if (generation && !log.generation) log.generation = generation;
    if (!log.projection) {
      this.setProjection(log, snapshot, sessionId);
      return { epoch: log.epoch, seq: log.seq };
    }
    const incoming = applyGuestSnapshot(new Map(), snapshot).find(
      (session) => session.id === sessionId
    );
    if (!incoming || matchesSnapshot(log.projection, incoming.view)) {
      return { epoch: log.epoch, seq: log.seq };
    }
    const cursor = this.resetSession(sessionId, generation ?? log.generation);
    log = this.logs.get(sessionId);
    if (log) this.setProjection(log, snapshot, sessionId);
    return cursor;
  }

  record(value: unknown): PairReplayRecord | null {
    if (!isRecord(value) || value.type === 'snapshot' || value.type === 'worker-exited')
      return null;
    const identity = identityOf(value);
    if (!identity) return null;
    let log = this.logs.get(identity.sessionId);
    if (!log || (log.generation && identity.generation && log.generation !== identity.generation)) {
      this.resetSession(identity.sessionId, identity.generation);
      log = this.logs.get(identity.sessionId);
    } else if (!log.generation && identity.generation) {
      log.generation = identity.generation;
    }
    if (!log) return null;

    let event: Record<string, unknown>;
    let bytes: number;
    try {
      event = { ...clone(value), sessionId: identity.sessionId };
      bytes = Buffer.byteLength(JSON.stringify(event), 'utf8');
    } catch {
      return null;
    }
    if (log.seq === Number.MAX_SAFE_INTEGER) {
      this.resetSession(identity.sessionId, identity.generation);
      log = this.logs.get(identity.sessionId);
      if (!log) return null;
    }
    const seq = ++log.seq;
    if (bytes > this.limits.maxBytesPerSession) {
      this.clearEvents(log);
      log.floorSeq = seq;
    } else {
      log.events.push({ seq, bytes, event });
      log.bytes += bytes;
      this.totalBytes += bytes;
      while (
        log.events.length > this.limits.maxEventsPerSession ||
        log.bytes > this.limits.maxBytesPerSession
      ) {
        this.dropOldest(log);
      }
    }
    this.touch(identity.sessionId, log);
    this.enforceGlobalLimits(identity.sessionId);
    log.projection = applyGuestEvent(log.projection ?? emptyGuestView(), event).view;
    this.trimProjection(log);
    return {
      sessionId: identity.sessionId,
      cursor: { epoch: log.epoch, seq },
      event: clone(event),
    };
  }

  replay(sessionId: string, cursor: PairSyncCursor): PairReplaySlice | null {
    const log = this.logs.get(sessionId);
    if (!log || log.epoch !== cursor.epoch || cursor.seq < log.floorSeq || cursor.seq > log.seq) {
      return null;
    }
    this.touch(sessionId, log);
    const events = log.events.filter((entry) => entry.seq > cursor.seq).map((entry) => entry.event);
    if (events.length !== log.seq - cursor.seq) return null;
    return {
      cursor: { epoch: log.epoch, seq: log.seq },
      fromSeq: cursor.seq,
      events: clone(events),
    };
  }

  invalidateAll(): void {
    this.logs.clear();
    this.totalBytes = 0;
  }

  private touch(sessionId: string, log: SessionLog): void {
    this.logs.delete(sessionId);
    this.logs.set(sessionId, log);
  }

  private setProjection(
    log: SessionLog,
    snapshot: { sessions?: unknown[] },
    sessionId: string
  ): void {
    log.projection =
      applyGuestSnapshot(new Map(), snapshot).find((session) => session.id === sessionId)?.view ??
      emptyGuestView();
    this.trimProjection(log);
  }

  private trimProjection(log: SessionLog): void {
    const messages = log.projection?.messages;
    if (!messages) return;
    while (messages.size > SNAPSHOT_TAIL_MESSAGES) {
      messages.delete(Math.min(...messages.keys()));
    }
  }

  private dropOldest(log: SessionLog): void {
    const dropped = log.events.shift();
    if (!dropped) return;
    log.bytes -= dropped.bytes;
    this.totalBytes -= dropped.bytes;
    log.floorSeq = dropped.seq;
  }

  private clearEvents(log: SessionLog): void {
    this.totalBytes -= log.bytes;
    log.events = [];
    log.bytes = 0;
  }

  private remove(sessionId: string): void {
    const log = this.logs.get(sessionId);
    if (!log) return;
    this.totalBytes -= log.bytes;
    this.logs.delete(sessionId);
  }

  private enforceGlobalLimits(currentSessionId: string): void {
    while (this.logs.size > this.limits.maxSessions) {
      const oldest = this.logs.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.remove(oldest);
    }
    while (this.totalBytes > this.limits.maxTotalBytes) {
      const oldest = this.logs.keys().next().value;
      if (typeof oldest !== 'string') break;
      if (oldest !== currentSessionId || this.logs.size > 1) {
        this.remove(oldest);
        continue;
      }
      const current = this.logs.get(oldest);
      if (!current) break;
      this.clearEvents(current);
      current.floorSeq = current.seq;
    }
  }
}
