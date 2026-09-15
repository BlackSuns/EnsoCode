import type { PairSessionSync, PairSyncCursor } from './protocol';

const MAX_SYNC_STRING_CHARS = 512;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBoundedString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_SYNC_STRING_CHARS;
const isSequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

export function isPairSyncCursor(value: unknown): value is PairSyncCursor {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['epoch', 'seq']) &&
    isBoundedString(value.epoch) &&
    isSequence(value.seq)
  );
}

function isSessionSnapshot(value: unknown, sessionId: string): boolean {
  if (!isRecord(value) || value.type !== 'snapshot' || !Array.isArray(value.sessions)) return false;
  if (value.sessions.length !== 1) return false;
  const session = value.sessions[0];
  if (!isRecord(session) || session.sessionId !== sessionId) return false;
  if (!Array.isArray(session.messages) || !isSequence(session.baseIndex)) return false;
  if (session.identity !== undefined) {
    if (!isRecord(session.identity) || session.identity.sessionId !== sessionId) return false;
  }
  return true;
}

export function parsePairSessionSync(value: unknown): PairSessionSync | null {
  if (!isRecord(value) || value.type !== 'session-sync') return null;
  if (
    !isBoundedString(value.sessionId) ||
    !isBoundedString(value.requestId) ||
    !isPairSyncCursor(value.cursor)
  ) {
    return null;
  }
  if (value.mode === 'snapshot') {
    return hasExactKeys(value, ['type', 'sessionId', 'requestId', 'cursor', 'mode', 'snapshot']) &&
      isSessionSnapshot(value.snapshot, value.sessionId)
      ? (value as unknown as PairSessionSync)
      : null;
  }
  if (value.mode !== 'replay') return null;
  if (
    !hasExactKeys(value, [
      'type',
      'sessionId',
      'requestId',
      'cursor',
      'mode',
      'fromSeq',
      'events',
    ]) ||
    !isSequence(value.fromSeq) ||
    !Array.isArray(value.events) ||
    value.fromSeq > value.cursor.seq ||
    value.events.length !== value.cursor.seq - value.fromSeq
  ) {
    return null;
  }
  return value.events.every(
    (event) => isRecord(event) && isBoundedString(event.type) && event.sessionId === value.sessionId
  )
    ? (value as unknown as PairSessionSync)
    : null;
}
