import { describe, expect, it } from 'vitest';
import { relocateHashlinePatch } from './relocate';

const createBudgetFixture = () => {
  const lines: string[] = [];
  const addGroup = (value: string) => {
    lines.push(...Array<string>(9_000).fill(value));
    const start = lines.length + 1;
    lines.push(...Array<string>(60).fill(value), `${value}-end`);
    return Array.from(
      { length: 10 },
      (_, index) =>
        `PUT ${start + 3 + index * 6}.=${start + 3 + index * 6}:\n+${value}-edited-${index}`
    ).join('\n');
  };

  const patchA = addGroup('A');
  lines.push('between groups');
  const insertionIndex = lines.length;
  const patchB = addGroup('B');
  const liveLines = [...lines];
  liveLines.splice(insertionIndex, 0, 'external insertion');

  return {
    snapshot: `${lines.join('\n')}\n`,
    live: `${liveLines.join('\n')}\n`,
    patchA,
    patchB,
  };
};

describe('relocateHashlinePatch', () => {
  it.each([
    ['snapshot', true],
    ['live', false],
  ])('%s 超过 2 MiB UTF-8 字节时拒绝恢复', (_side, snapshotIsLarge) => {
    const base = 'target\ncontext one\ncontext two\ncontext three\n';
    const oversized = `${base}${'界'.repeat(Math.floor((2 * 1024 * 1024) / 3) + 1)}`;
    expect(oversized.length).toBeLessThan(2 * 1024 * 1024);
    expect(Buffer.byteLength(oversized, 'utf8')).toBeGreaterThan(2 * 1024 * 1024);

    expect(() =>
      relocateHashlinePatch(
        snapshotIsLarge ? oversized : base,
        snapshotIsLarge ? base : oversized,
        'PUT 1.=1:\n+replacement'
      )
    ).toThrow();
  });

  it.each([
    ['snapshot', true],
    ['live', false],
  ])('%s 超过 50000 个可寻址行时拒绝恢复', (_side, snapshotIsLarge) => {
    const base = 'target\ncontext one\ncontext two\ncontext three\n';
    const oversized = `${base}${'external\n'.repeat(49_997)}`;

    expect(() =>
      relocateHashlinePatch(
        snapshotIsLarge ? oversized : base,
        snapshotIsLarge ? base : oversized,
        'PUT 1.=1:\n+replacement'
      )
    ).toThrow();
  });

  it('快照末行是无换行空白且磁盘已删除该行时拒绝借用后续非目标行', () => {
    expect(() => relocateHashlinePatch('a\n ', 'x\na\nb\nc\n', 'PUT 2.=2:\n+REPLACED')).toThrow();
  });

  it('快照末行是无换行空白且磁盘仍保留该行时精确重定位', () => {
    expect(relocateHashlinePatch('a\n ', 'x\na\n ', 'PUT 2.=2:\n+REPLACED')).toEqual({
      patch: 'PUT 3.=3:\n+REPLACED',
      ranges: [{ from: { start: 2, end: 2 }, to: { start: 3, end: 3 } }],
    });
  });

  it('整份 patch 的所有定位组共享逐行比较预算', () => {
    const { snapshot, live, patchA, patchB } = createBudgetFixture();

    expect(() => relocateHashlinePatch(snapshot, live, patchA)).not.toThrow();
    expect(() => relocateHashlinePatch(snapshot, live, patchB)).not.toThrow();
    expect(() => relocateHashlinePatch(snapshot, live, `${patchA}\n${patchB}`)).toThrow();
  });
});
