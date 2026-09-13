import { randomUUID } from 'node:crypto';
import { constants, realpathSync, type Stats } from 'node:fs';
import { access, chmod, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { PatchEntry, PatchIo } from './types';

export function normalizePatchPath(value: string): string {
  if (!value || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Patch path must be relative to the workspace: ${value}`);
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Patch path escapes the workspace: ${value}`);
  }
  return normalized;
}

export function createLocalApplyPatchIo(cwd: string): PatchIo {
  const root = realpathSync(cwd);
  const checkSignal = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error('apply_patch cancelled');
  };
  const absolute = (relative: string) =>
    path.join(root, ...normalizePatchPath(relative).split('/'));

  async function inspect(
    relative: string,
    maxBytes = 4 * 1024 * 1024,
    signal?: AbortSignal
  ): Promise<PatchEntry> {
    checkSignal(signal);
    const normalized = normalizePatchPath(relative);
    const segments = normalized.split('/');
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      checkSignal(signal);
      current = path.join(current, segments[index]);
      let stats: Stats;
      try {
        stats = await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await access(path.dirname(current), constants.W_OK | constants.X_OK);
          return { kind: 'missing', canonicalPath: absolute(normalized) };
        }
        throw error;
      }
      if (stats.isSymbolicLink()) return { kind: 'symlink', canonicalPath: current };
      if (index < segments.length - 1 && !stats.isDirectory()) {
        return { kind: 'other', canonicalPath: current };
      }
      if (index === segments.length - 1) {
        const canonicalPath = await realpath(current);
        if (stats.isDirectory()) return { kind: 'directory', canonicalPath };
        await access(path.dirname(current), constants.W_OK | constants.X_OK);
        if (!stats.isFile()) return { kind: 'other', canonicalPath };
        if (stats.size > maxBytes)
          throw new Error(`File exceeds apply_patch read limit: ${relative}`);
        const handle = await open(current, 'r');
        try {
          const buffer = Buffer.alloc(Math.min(stats.size + 1, maxBytes + 1));
          let length = 0;
          while (length < buffer.length) {
            checkSignal(signal);
            const read = await handle.read(buffer, length, buffer.length - length, null);
            if (read.bytesRead === 0) break;
            length += read.bytesRead;
          }
          const after = await handle.stat();
          if (length > maxBytes)
            throw new Error(`File exceeds apply_patch read limit: ${relative}`);
          if (after.size !== length) throw new Error(`File changed while reading: ${relative}`);
          const raw = Buffer.alloc(length);
          buffer.copy(raw, 0, 0, length);
          return { kind: 'file', canonicalPath, raw };
        } finally {
          await handle.close();
        }
      }
    }
    throw new Error(`Invalid patch path: ${relative}`);
  }

  async function ensureParents(relative: string, signal?: AbortSignal): Promise<void> {
    const segments = normalizePatchPath(relative).split('/').slice(0, -1);
    let current = root;
    for (const segment of segments) {
      checkSignal(signal);
      current = path.join(current, segment);
      try {
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
          throw new Error(`Unsafe patch parent: ${current}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        checkSignal(signal);
        await mkdir(current);
      }
    }
  }

  return {
    inspect,
    async write(relative, raw, options) {
      await ensureParents(relative, options.signal);
      checkSignal(options.signal);
      const target = absolute(relative);
      if (options.exclusive) {
        const handle = await open(target, 'wx');
        try {
          await handle.writeFile(raw);
        } finally {
          await handle.close();
        }
        return;
      }
      const before = await lstat(target);
      checkSignal(options.signal);
      if (before.isSymbolicLink() || !before.isFile())
        throw new Error(`Unsafe update target: ${relative}`);
      const temporary = path.join(
        path.dirname(target),
        `.${path.basename(target)}.enso-patch-${process.pid}-${randomUUID()}`
      );
      const handle = await open(temporary, 'wx', before.mode);
      try {
        await handle.writeFile(raw);
        await handle.close();
        await chmod(temporary, before.mode);
        checkSignal(options.signal);
        await rename(temporary, target);
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(temporary).catch(() => {});
        throw error;
      }
    },
    async remove(relative, signal) {
      const entry = await inspect(relative, undefined, signal);
      checkSignal(signal);
      if (entry.kind !== 'file')
        throw new Error(`Delete target is not a regular file: ${relative}`);
      await unlink(absolute(relative));
    },
  };
}
