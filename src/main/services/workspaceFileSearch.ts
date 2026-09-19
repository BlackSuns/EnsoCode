import { spawn } from 'node:child_process';
import path from 'node:path';
import type { FilesSearchContentHit, FilesSearchNameHit, FilesSearchResult } from '@shared/types';
import type { ParsedWorkspaceFileSearchRequest } from '@shared/workspaceFileSearch';
import { fuzzyScore } from './fileSearch';

const SEARCH_TIMEOUT_MS = 10_000;
const EXCLUDE_GLOBS = [
  '!node_modules/**',
  '!dist/**',
  '!build/**',
  '!.git/**',
  '!*.lock',
  '!package-lock.json',
];

export type RgRunner = (args: string[], cwd: string) => Promise<{ code: number; stdout: string }>;

export function toRelativePosix(root: string, candidate: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const rel = path.relative(resolvedRoot, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

export function rankNameHits(
  files: readonly string[],
  query: string,
  maxResults: number
): FilesSearchNameHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();
  return files
    .map((relativePath) => {
      const name = relativePath.split('/').pop() || relativePath;
      let score = Math.max(fuzzyScore(trimmed, name) * 2, fuzzyScore(trimmed, relativePath));
      if (name.toLowerCase() === needle) score += 1000;
      return { relativePath, name, score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ relativePath, name }) => ({ relativePath, name }));
}

export function parseRipgrepJsonMatch(line: string, root: string): FilesSearchContentHit | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const rec = json as Record<string, unknown>;
  if (rec.type !== 'match' || !rec.data || typeof rec.data !== 'object' || Array.isArray(rec.data))
    return null;
  const data = rec.data as Record<string, unknown>;
  const pathRec = data.path;
  const pathText =
    pathRec && typeof pathRec === 'object' && !Array.isArray(pathRec)
      ? (pathRec as Record<string, unknown>).text
      : undefined;
  if (typeof pathText !== 'string' || typeof data.line_number !== 'number') return null;
  const abs = path.isAbsolute(pathText) ? pathText : path.join(root, pathText);
  const relativePath = toRelativePosix(root, abs);
  if (!relativePath) return null;
  const lines = data.lines;
  const text =
    lines && typeof lines === 'object' && !Array.isArray(lines)
      ? (lines as Record<string, unknown>).text
      : '';
  const submatches = Array.isArray(data.submatches) ? data.submatches[0] : undefined;
  const start =
    submatches && typeof submatches === 'object' && !Array.isArray(submatches)
      ? (submatches as Record<string, unknown>).start
      : 0;
  const end =
    submatches && typeof submatches === 'object' && !Array.isArray(submatches)
      ? (submatches as Record<string, unknown>).end
      : 0;
  const column = typeof start === 'number' ? start : 0;
  const matchEnd = typeof end === 'number' ? end : column;
  return {
    relativePath,
    line: data.line_number,
    column,
    matchLength: Math.max(0, matchEnd - column),
    content: typeof text === 'string' ? text.replace(/\n$/, '') : '',
  };
}

export function buildNameSearchArgs(): string[] {
  return ['--files', ...EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]), '.'];
}

export function buildContentSearchArgs(opts: {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}): string[] {
  const args = [
    '--json',
    '--line-number',
    '--column',
    '--max-count',
    '100',
    '--max-filesize',
    '1M',
    ...EXCLUDE_GLOBS.flatMap((glob) => ['--glob', glob]),
  ];
  if (!opts.caseSensitive) args.push('-i');
  if (opts.wholeWord) args.push('-w');
  if (!opts.regex) args.push('-F');
  args.push('--', opts.query, '.');
  return args;
}

export async function spawnRipgrep(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string }> {
  const { rgPath: originalRgPath } = await import('@vscode/ripgrep');
  const rgPath = originalRgPath.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  return new Promise((resolve) => {
    const child = spawn(rgPath, args, { cwd, windowsHide: true });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 2, stdout });
    }, SEARCH_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: 2, stdout: '' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 2, stdout });
    });
  });
}

function listedRelativeFiles(stdout: string, cwd: string): string[] {
  const files: string[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const abs = path.isAbsolute(trimmed) ? trimmed : path.join(cwd, trimmed);
    const rel = toRelativePosix(cwd, abs);
    if (rel) files.push(rel);
  }
  return files;
}

export async function searchWorkspaceFiles(
  cwd: string,
  request: ParsedWorkspaceFileSearchRequest,
  run: RgRunner = spawnRipgrep
): Promise<FilesSearchResult> {
  if (request.mode === 'names') {
    if (!request.query.trim()) return { ok: true, mode: 'names', hits: [] };
    const { stdout, code } = await run(buildNameSearchArgs(), cwd);
    if (code === 2) return { ok: false, error: 'unavailable' };
    return {
      ok: true,
      mode: 'names',
      hits: rankNameHits(listedRelativeFiles(stdout, cwd), request.query, request.maxResults),
    };
  }
  if (!request.query.trim()) return { ok: true, mode: 'content', hits: [], truncated: false };
  const { stdout, code } = await run(
    buildContentSearchArgs({
      query: request.query,
      caseSensitive: request.caseSensitive,
      wholeWord: request.wholeWord,
      regex: request.regex,
    }),
    cwd
  );
  if (code === 2) return { ok: false, error: 'unavailable' };
  const hits: FilesSearchContentHit[] = [];
  let truncated = false;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const hit = parseRipgrepJsonMatch(line, cwd);
    if (!hit) continue;
    if (hits.length >= request.maxResults) {
      truncated = true;
      break;
    }
    hits.push(hit);
  }
  return { ok: true, mode: 'content', hits, truncated };
}
