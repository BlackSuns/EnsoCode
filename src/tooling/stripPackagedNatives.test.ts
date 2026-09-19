import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  afterPack,
  hostPrebuildName,
  stripForeignSqlitePrebuilds,
  unpackedAppDir,
} from './stripPackagedNatives.mjs';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('stripPackagedNatives', () => {
  it('keeps only the host better-sqlite3 prebuild', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-prebuilds-'));
    dirs.push(root);
    for (const name of [
      'darwin-arm64.node',
      'darwin-x64.node',
      'linux-x64.node',
      'linux-arm64.node',
      'linuxmusl-x64.node',
      'win32-x64.node',
      'win32-arm64.node',
    ]) {
      writeFileSync(path.join(root, name), 'x');
    }
    expect(stripForeignSqlitePrebuilds(root, 'darwin', 'arm64')).toEqual(
      expect.arrayContaining([
        'darwin-x64.node',
        'linux-x64.node',
        'win32-x64.node',
        'linuxmusl-x64.node',
      ])
    );
    expect(readdirSync(root)).toEqual(['darwin-arm64.node']);
  });

  it('resolves unpacked paths and host prebuild names per platform', () => {
    expect(hostPrebuildName('darwin', 'arm64')).toBe('darwin-arm64.node');
    expect(hostPrebuildName('win32', 'x64')).toBe('win32-x64.node');
    expect(unpackedAppDir('/out', 'darwin', 'EnsoCode')).toBe(
      path.join('/out', 'EnsoCode.app', 'Contents', 'Resources', 'app.asar.unpacked')
    );
    expect(unpackedAppDir('/out', 'linux', 'EnsoCode')).toBe(
      path.join('/out', 'resources', 'app.asar.unpacked')
    );
  });

  it('no-ops when the prebuilds directory is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-missing-'));
    dirs.push(root);
    expect(stripForeignSqlitePrebuilds(path.join(root, 'nope'), 'darwin', 'arm64')).toEqual([]);
  });

  it('afterPack strips foreign prebuilds from the mac unpacked tree', async () => {
    const appOutDir = mkdtempSync(path.join(tmpdir(), 'enso-appout-'));
    dirs.push(appOutDir);
    const prebuilds = path.join(
      unpackedAppDir(appOutDir, 'darwin', 'EnsoCode'),
      'node_modules',
      'better-sqlite3',
      'prebuilds'
    );
    mkdirSync(prebuilds, { recursive: true });
    writeFileSync(path.join(prebuilds, 'darwin-arm64.node'), 'keep');
    writeFileSync(path.join(prebuilds, 'linux-x64.node'), 'drop');
    await afterPack({
      appOutDir,
      electronPlatformName: 'darwin',
      arch: 3,
      packager: { appInfo: { productFilename: 'EnsoCode' } },
    });
    expect(readdirSync(prebuilds)).toEqual(['darwin-arm64.node']);
  });
});
