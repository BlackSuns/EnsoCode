import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectOsSandboxBackend, osSandboxSpawnHook, wrapOsSandboxCommand } from './osSandbox';

describe('osSandbox', () => {
  it('无后端时不改命令', () => {
    expect(wrapOsSandboxCommand('echo hi', '/tmp/proj', { backend: null })).toBe('echo hi');
  });

  it('seatbelt 包装含 sandbox-exec 与 cwd 子路径', () => {
    const wrapped = wrapOsSandboxCommand('echo hi', '/tmp/proj', { backend: 'seatbelt' });
    expect(wrapped).toContain('sandbox-exec');
    expect(wrapped).toContain('(subpath "/tmp/proj")');
    expect(wrapped).toContain('echo hi');
  });

  it('bwrap 只绑定 cwd 可写', () => {
    const wrapped = wrapOsSandboxCommand('echo hi', '/work', { backend: 'bwrap' });
    expect(wrapped).toContain('bwrap');
    expect(wrapped).toContain('--ro-bind / /');
    expect(wrapped).toContain('--bind');
    expect(wrapped).toContain('/work');
  });

  it('spawnHook 在有后端时改写 command', () => {
    const hook = osSandboxSpawnHook('/tmp/proj', { backend: 'seatbelt' });
    const next = hook({ command: 'ls', cwd: '/tmp/proj', env: {} });
    expect(next.cwd).toBe('/tmp/proj');
    expect(next.command).toContain('sandbox-exec');
  });
});

describe('osSandbox live', () => {
  const leftovers: string[] = [];
  afterEach(() => {
    for (const file of leftovers) {
      try {
        unlinkSync(file);
      } catch {}
    }
    leftovers.length = 0;
  });

  it('允许写 cwd，拒绝写 home', () => {
    const backend = detectOsSandboxBackend();
    if (!backend) return;
    if (backend === 'seatbelt' && !canApplySeatbelt()) return;
    const cwd = mkdtempSync(path.join(tmpdir(), 'enso-sbx-'));
    leftovers.push(path.join(cwd, 'ok.txt'));
    const outside = path.join(homedir(), `.enso-sbx-probe-${process.pid}`);
    leftovers.push(outside);
    try {
      const allow = wrapOsSandboxCommand('echo inside > ok.txt', cwd, { backend });
      execFileSync('/bin/bash', ['-lc', allow], { cwd, timeout: 10_000 });
      expect(readFileSync(path.join(cwd, 'ok.txt'), 'utf8')).toContain('inside');

      const deny = wrapOsSandboxCommand(`echo pwned > ${outside}`, cwd, { backend });
      try {
        execFileSync('/bin/bash', ['-lc', deny], { cwd, timeout: 10_000, stdio: 'pipe' });
      } catch {
        // sandbox deny exits non-zero
      }
      expect(existsSync(outside)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('osSandbox profile paths', () => {
  it('允许 tmpdir 写入位', () => {
    const wrapped = wrapOsSandboxCommand('true', '/repo', {
      backend: 'seatbelt',
      tmpDir: '/var/folders/xx/T',
    });
    expect(wrapped).toContain('(subpath "/var/folders/xx/T")');
  });
});

function canApplySeatbelt(): boolean {
  try {
    execFileSync('/usr/bin/sandbox-exec', ['-p', '(version 1)\n(allow default)', '/usr/bin/true'], {
      timeout: 5000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}
