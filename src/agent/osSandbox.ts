import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BashSpawnHook } from '@earendil-works/pi-coding-agent';
import { shellQuote } from '@shared/ssh';

export type OsSandboxBackend = 'seatbelt' | 'bwrap';

export interface OsSandboxWrapOptions {
  backend?: OsSandboxBackend | null;
  tmpDir?: string;
}

function resolvedPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

export function detectOsSandboxBackend(platform = process.platform): OsSandboxBackend | null {
  if (platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) return 'seatbelt';
  if (platform === 'linux') {
    for (const candidate of ['/usr/bin/bwrap', '/usr/local/bin/bwrap']) {
      if (existsSync(candidate)) return 'bwrap';
    }
  }
  return null;
}

function seatbeltProfile(cwd: string, tmpDir: string): string {
  const roots = new Set([
    resolvedPath(cwd),
    resolvedPath(tmpDir),
    '/tmp',
    '/private/tmp',
    '/private/var/folders',
    '/dev',
  ]);
  const allows = [...roots].map((root) => `  (subpath "${root}")`).join('\n');
  return `(version 1)
(allow default)
(deny file-write*)
(allow file-write*
${allows}
)`;
}

export function wrapOsSandboxCommand(
  command: string,
  cwd: string,
  options: OsSandboxWrapOptions = {}
): string {
  const backend = options.backend === undefined ? detectOsSandboxBackend() : options.backend;
  if (!backend) return command;
  const tmpDir = options.tmpDir ?? tmpdir();
  if (backend === 'seatbelt') {
    return `sandbox-exec -p ${shellQuote(seatbeltProfile(cwd, tmpDir))} /bin/bash -lc ${shellQuote(command)}`;
  }
  const binds = [`--bind ${shellQuote(resolvedPath(cwd))} ${shellQuote(resolvedPath(cwd))}`];
  const resolvedTmp = resolvedPath(tmpDir);
  if (resolvedTmp !== '/tmp' && resolvedTmp !== '/private/tmp') {
    binds.push(`--bind ${shellQuote(resolvedTmp)} ${shellQuote(resolvedTmp)}`);
  }
  return [
    'bwrap',
    '--die-with-parent',
    '--ro-bind / /',
    '--dev /dev',
    '--proc /proc',
    '--tmpfs /tmp',
    ...binds,
    `--chdir ${shellQuote(resolvedPath(cwd))}`,
    `/bin/bash -lc ${shellQuote(command)}`,
  ].join(' ');
}

export function osSandboxSpawnHook(
  defaultCwd: string,
  options: OsSandboxWrapOptions = {}
): BashSpawnHook {
  return (context) => ({
    ...context,
    command: wrapOsSandboxCommand(context.command, context.cwd || defaultCwd, options),
  });
}
