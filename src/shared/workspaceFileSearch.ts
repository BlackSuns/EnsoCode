import type { FilesSearchMode, FilesSearchRequest } from './types/filesWorkspace';

export type ParsedWorkspaceFileSearchRequest = FilesSearchRequest & {
  maxResults: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

const MODES = new Set<FilesSearchMode>(['names', 'content']);
const MAX_RESULTS_CAP = 500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function clampMaxResults(value: unknown, mode: FilesSearchMode): number {
  const fallback = mode === 'content' ? 200 : 80;
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_RESULTS_CAP, Math.max(1, Math.trunc(value)));
}

export function parseWorkspaceFileSearchRequest(
  value: unknown
): ParsedWorkspaceFileSearchRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.conversationId) || !isNonEmptyString(record.projectId)) return null;
  if (typeof record.query !== 'string') return null;
  if (typeof record.mode !== 'string' || !MODES.has(record.mode as FilesSearchMode)) return null;
  const mode = record.mode as FilesSearchMode;
  return {
    conversationId: record.conversationId,
    projectId: record.projectId,
    query: record.query,
    mode,
    maxResults: clampMaxResults(record.maxResults, mode),
    caseSensitive: record.caseSensitive === true,
    wholeWord: record.wholeWord === true,
    regex: record.regex === true,
  };
}
