import path from 'node:path';
import type { SshExecResult, SshExecutor } from '../ssh/executor';
import { toPosixRemotePath } from '../ssh/posixPath';
import type { PatchEntry, PatchIo } from './types';
import { PatchMutationUncertainError } from './types';

function normalizeRemotePatchPath(value: string): string {
  if (!value || /^[A-Za-z]:/.test(value) || value.startsWith('\\') || value.startsWith('//')) {
    throw new Error(`Patch path is not a valid POSIX path: ${value}`);
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (
    normalized === '/' ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Patch path escapes the workspace: ${value}`);
  }
  return normalized;
}

function resolveRemoteTarget(cwd: string, value: string): { root: string; relative: string } {
  const normalized = normalizeRemotePatchPath(value);
  if (path.posix.isAbsolute(normalized)) return { root: '/', relative: normalized.slice(1) };
  const root = path.posix.normalize(toPosixRemotePath(cwd));
  if (!path.posix.isAbsolute(root)) throw new Error(`Remote workspace must be absolute: ${cwd}`);
  return { root, relative: normalized };
}

const INSPECT_SCRIPT = String.raw`set -f
root=$(cd -P "$1" 2>/dev/null && pwd) || exit 70
rel=$2
if [ "$root" = / ]; then target=/$rel; else target=$root/$rel; fi
current=$root
oldifs=$IFS
IFS=/
set -- $rel
IFS=$oldifs
index=1
count=$#
for part do
  parent=$current
  if [ "$current" = / ]; then current=/$part; else current=$current/$part; fi
  if [ -L "$current" ]; then printf 'symlink\n%s\n' "$current"; exit 0; fi
  if [ ! -e "$current" ]; then
    [ -w "$parent" ] && [ -x "$parent" ] || exit 79
    printf 'missing\n%s\n' "$target"
    exit 0
  fi
  if [ "$index" -lt "$count" ] && [ ! -d "$current" ]; then printf 'other\n%s\n' "$current"; exit 0; fi
  index=$((index + 1))
done
if [ -f "$current" ]; then
  [ -w "$parent" ] && [ -x "$parent" ] || exit 79
  kind=file
elif [ -d "$current" ]; then kind=directory
else kind=other
fi
printf '%s\n%s\n' "$kind" "$current"`;

const CAT_SCRIPT = `set -f
root=$(cd -P "$1" 2>/dev/null && pwd) || exit 70
max=$2
rel=$3
if [ "$root" = / ]; then target=/$rel; else target=$root/$rel; fi
head -c "$max" "$target"`;

const WRITE_SCRIPT = `set -f
root=$(cd -P "$1" 2>/dev/null && pwd) || exit 70
exclusive=$2
rel=$3
parent=$(dirname -- "$rel")
if [ "$parent" = . ]; then parent=; fi
current=$root
oldifs=$IFS
IFS=/
set -- $parent
IFS=$oldifs
for part do
  [ -n "$part" ] || continue
  if [ "$current" = / ]; then current=/$part; else current=$current/$part; fi
  if [ -L "$current" ]; then exit 71
  elif [ -e "$current" ]; then [ -d "$current" ] || exit 72
  else mkdir -- "$current" || exit 73
  fi
done
if [ "$root" = / ]; then target=/$rel; else target=$root/$rel; fi
[ ! -L "$target" ] || exit 74
if [ "$exclusive" = 1 ]; then
  (set -C; cat > "$target")
  exit $?
fi
[ -f "$target" ] || exit 75
if [ "$current" = / ]; then template=/.enso-patch.XXXXXX; else template=$current/.enso-patch.XXXXXX; fi
tmp=$(mktemp "$template") || exit 76
cleanup() { [ -z "$tmp" ] || rm -f -- "$tmp"; }
trap cleanup 0
trap 'exit 79' 1 2 15
cat > "$tmp" || exit 76
mode=$(stat -c %a "$target" 2>/dev/null || stat -f %Lp "$target" 2>/dev/null) || exit 77
chmod "$mode" "$tmp" && mv -f -- "$tmp" "$target" || exit 78
tmp=
trap - 0 1 2 15`;

const REMOVE_SCRIPT = `set -f
root=$(cd -P "$1" 2>/dev/null && pwd) || exit 70
rel=$2
current=$root
oldifs=$IFS
IFS=/
set -- $rel
IFS=$oldifs
for part do
  if [ "$current" = / ]; then current=/$part; else current=$current/$part; fi
  [ ! -L "$current" ] || exit 71
done
[ -f "$current" ] || exit 72
rm -- "$current"`;

function command(script: string, root: string, relative: string, ...extra: string[]): string[] {
  return ['sh', '-c', script, 'enso-apply-patch', root, ...extra, relative];
}

export function createRemoteApplyPatchIo(cwd: string, executor: SshExecutor): PatchIo {
  return {
    normalizePath: normalizeRemotePatchPath,
    async inspect(value, maxBytes = 4 * 1024 * 1024, signal, timeoutMs = 30_000) {
      const { root, relative } = resolveRemoteTarget(cwd, value);
      const result = await executor.exec(command(INSPECT_SCRIPT, root, relative), {
        signal,
        timeoutMs,
      });
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Cannot inspect ${relative}`);
      const newline = result.stdout.indexOf('\n');
      const second = result.stdout.indexOf('\n', newline + 1);
      const kind = result.stdout.slice(0, newline) as PatchEntry['kind'];
      const canonicalPath = result.stdout.slice(newline + 1, second < 0 ? undefined : second);
      if (!['missing', 'file', 'directory', 'symlink', 'other'].includes(kind)) {
        throw new Error(`Invalid remote inspection for ${relative}`);
      }
      if (kind !== 'file') return { kind, canonicalPath };
      const raw = await executor.execRaw(
        command(CAT_SCRIPT, root, relative, String(maxBytes + 1)),
        { signal, timeoutMs }
      );
      if (raw.code !== 0) throw new Error(raw.stderr.trim() || `Cannot read ${relative}`);
      if (raw.stdout.length > maxBytes)
        throw new Error(`File exceeds apply_patch read limit: ${relative}`);
      return { kind, canonicalPath, raw: raw.stdout };
    },
    async write(value, raw, options) {
      const { root, relative } = resolveRemoteTarget(cwd, value);
      let result: SshExecResult;
      try {
        result = await executor.exec(
          command(WRITE_SCRIPT, root, relative, options.exclusive ? '1' : '0'),
          { stdin: raw, signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000 }
        );
      } catch (error) {
        throw new PatchMutationUncertainError(
          error instanceof Error ? error.message : `SSH transport failed while writing ${relative}`
        );
      }
      if (result.code === 255) {
        throw new PatchMutationUncertainError(
          result.stderr.trim() || `SSH transport failed while writing ${relative}`
        );
      }
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Cannot write ${relative}`);
    },
    async remove(value, signal, timeoutMs = 30_000) {
      const { root, relative } = resolveRemoteTarget(cwd, value);
      let result: SshExecResult;
      try {
        result = await executor.exec(command(REMOVE_SCRIPT, root, relative), {
          signal,
          timeoutMs,
        });
      } catch (error) {
        throw new PatchMutationUncertainError(
          error instanceof Error ? error.message : `SSH transport failed while deleting ${relative}`
        );
      }
      if (result.code === 255) {
        throw new PatchMutationUncertainError(
          result.stderr.trim() || `SSH transport failed while deleting ${relative}`
        );
      }
      if (result.code !== 0) throw new Error(result.stderr.trim() || `Cannot delete ${relative}`);
    },
  };
}
