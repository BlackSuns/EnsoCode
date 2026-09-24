import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';

const CPU_ARCH = new Map([
  [0x01000007, 'x64'],
  [0x0100000c, 'arm64'],
]);
const MAX_FAT_ARCHS = 16;

const cpuName = (cpu) => CPU_ARCH.get(cpu) ?? `cpu:${cpu.toString(16)}`;

/** Mach-O 头里的架构列表；非 Mach-O 返回 null */
export function machOArchs(buffer) {
  if (buffer.length < 8) return null;
  if (buffer.readUInt32LE(0) === 0xfeedfacf || buffer.readUInt32LE(0) === 0xfeedface) {
    return [cpuName(buffer.readInt32LE(4))];
  }
  const magic = buffer.readUInt32BE(0);
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return null;
  const count = buffer.readUInt32BE(4);
  const entrySize = magic === 0xcafebabf ? 32 : 20;
  // Java class 同魔数，这个位置是版本号（>=45），真实 fat 文件架构数很少
  if (count === 0 || count > MAX_FAT_ARCHS || buffer.length < 8 + count * entrySize) return null;
  return Array.from({ length: count }, (_, index) =>
    cpuName(buffer.readInt32BE(8 + index * entrySize))
  );
}

function readHead(file) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(8 + MAX_FAT_ARCHS * 32);
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0));
  } finally {
    closeSync(fd);
  }
}

/** 遍历目录，返回不含目标架构的 Mach-O（相对路径）；符号链接不跟随 */
export function findArchMismatches(root, arch) {
  const mismatches = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        const archs = machOArchs(readHead(file));
        if (archs && !archs.includes(arch)) {
          mismatches.push({ file: path.relative(root, file), archs });
        }
      }
    }
  };
  walk(root);
  return mismatches;
}
