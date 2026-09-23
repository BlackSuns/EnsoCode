import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/** electron-builder Arch enum: ia32, x64, armv7l, arm64, universal */
const ARCH_NAME = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

export function hostPrebuildName(platform, arch) {
  return `${platform}-${arch}.node`;
}

export function unpackedAppDir(appOutDir, platform, productFilename) {
  if (platform === 'darwin') {
    return path.join(
      appOutDir,
      `${productFilename}.app`,
      'Contents',
      'Resources',
      'app.asar.unpacked'
    );
  }
  return path.join(appOutDir, 'resources', 'app.asar.unpacked');
}

export function stripForeignSqlitePrebuilds(prebuildsDir, platform, arch) {
  if (!existsSync(prebuildsDir)) return [];
  const keep = hostPrebuildName(platform, arch);
  const removed = [];
  for (const name of readdirSync(prebuildsDir)) {
    if (name === keep) continue;
    rmSync(path.join(prebuildsDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/** 按 `<platform>-<arch>/` 分目录的预编译只留目标一份，交叉打包时别架构的 .node 不混进包 */
export function stripForeignPrebuildDirs(prebuildsDir, platform, arch) {
  if (!existsSync(prebuildsDir)) return [];
  const keep = `${platform}-${arch}`;
  const removed = [];
  for (const name of readdirSync(prebuildsDir)) {
    if (name === keep) continue;
    rmSync(path.join(prebuildsDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

function archName(arch) {
  if (typeof arch === 'string') return arch;
  return ARCH_NAME[arch] ?? String(arch);
}

export async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = archName(context.arch);
  const productFilename = context.packager.appInfo.productFilename;
  const modules = path.join(
    unpackedAppDir(context.appOutDir, platform, productFilename),
    'node_modules'
  );
  stripForeignSqlitePrebuilds(path.join(modules, 'better-sqlite3', 'prebuilds'), platform, arch);
  stripForeignPrebuildDirs(path.join(modules, 'node-pty', 'prebuilds'), platform, arch);
  const tuiNative = path.join(modules, '@earendil-works', 'pi-tui', 'native');
  if (existsSync(tuiNative)) {
    for (const name of readdirSync(tuiNative)) {
      stripForeignPrebuildDirs(path.join(tuiNative, name, 'prebuilds'), platform, arch);
    }
  }
}

export default afterPack;
