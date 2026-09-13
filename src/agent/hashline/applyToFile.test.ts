import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHashlineToFile } from './applyToFile';
import { computeFileHash, formatHashlineHeader } from './format';
import { InMemorySnapshotStore } from './snapshots';

const inputFor = (path: string, tag: string, patch = 'PUT 1.=1:\n+hello') =>
  `${formatHashlineHeader(path, tag)}\n${patch}`;

let tempDir: string;
let filePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'enso-hashline-apply-'));
  filePath = path.join(tempDir, 'target.ts');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const createStoreWithSnapshot = (original: string) => {
  const store = new InMemorySnapshotStore();
  const tag = store.record(filePath, original);
  return { store, tag };
};

const applyStalePatch = async (original: string, live: string, patch: string) => {
  const { store, tag } = createStoreWithSnapshot(original);
  writeFileSync(filePath, live, 'utf8');
  return applyHashlineToFile({
    store,
    readText: async (target) => readFileSync(target, 'utf8'),
    writeText: async (target, text) => writeFileSync(target, text, 'utf8'),
    input: inputFor(filePath, tag, patch),
  });
};

const applyWhileDiskChanges = async (
  original: string,
  initial: string,
  changed: string,
  patch: string
) => {
  const { store, tag } = createStoreWithSnapshot(original);
  let firstRead = true;
  writeFileSync(filePath, initial, 'utf8');
  return applyHashlineToFile({
    store,
    readText: async (target) => {
      const text = readFileSync(target, 'utf8');
      if (firstRead) {
        firstRead = false;
        writeFileSync(target, changed, 'utf8');
      }
      return text;
    },
    writeText: async (target, text) => writeFileSync(target, text, 'utf8'),
    input: inputFor(filePath, tag, patch),
  });
};

describe('applyHashlineToFile', () => {
  it('快照与磁盘一致时写入补丁、记录新标签并返回结果', async () => {
    const path = '/tmp/a.ts';
    const original = 'world\nlater\n';
    const next = 'hello\nlater\n';
    const store = new InMemorySnapshotStore();
    const tag = store.record(path, original);
    const writeText = vi.fn(async () => undefined);
    const result = await applyHashlineToFile({
      store,
      readText: async () => original,
      writeText,
      input: inputFor(path, tag),
    });
    expect(writeText).toHaveBeenCalledWith(path, next);
    expect(store.get(path, computeFileHash(next))).toBe(next);
    expect(result).toEqual({ path, previous: original, text: next, tag: computeFileHash(next) });
  });

  it.each([
    {
      change: '新增前缀',
      original:
        'far-prefix\nup three\nup two\nup one\nold target\ndown one\ndown two\ndown three\noriginal tail\n',
      live: 'external added\nfar-prefix\nup three\nup two\nup one\nold target\ndown one\ndown two\ndown three\nlive tail\n',
      patch: 'PUT 5.=5:\n+new target',
      expected:
        'external added\nfar-prefix\nup three\nup two\nup one\nnew target\ndown one\ndown two\ndown three\nlive tail\n',
      range: { from: { start: 5, end: 5 }, to: { start: 6, end: 6 } },
    },
    {
      change: '删除前缀',
      original:
        'far-prefix\nup three\nup two\nup one\nold target\ndown one\ndown two\ndown three\noriginal tail\n',
      live: 'up three\nup two\nup one\nold target\ndown one\ndown two\ndown three\nlive tail\n',
      patch: 'PUT 5.=5:\n+new target',
      expected: 'up three\nup two\nup one\nnew target\ndown one\ndown two\ndown three\nlive tail\n',
      range: { from: { start: 5, end: 5 }, to: { start: 4, end: 4 } },
    },
  ])(
    '磁盘在目标窗口至少四行外$change时重定位 PUT 并保留其他改动',
    async ({ original, live, patch, expected, range }) => {
      const result = await applyStalePatch(original, live, patch);
      expect(readFileSync(filePath, 'utf8')).toBe(expected);
      expect(result).toMatchObject({ relocation: { ranges: [range] } });
    }
  );

  it('磁盘仅修改目标下方第四行且行号未变时恢复 PUT', async () => {
    const original =
      'up three\nup two\nup one\nold target\ndown one\ndown two\ndown three\noriginal tail\n';
    const live =
      'up three\nup two\nup one\nold target\ndown one\ndown two\ndown three\nlive tail\n';

    const result = await applyStalePatch(original, live, 'PUT 4.=4:\n+new target');

    expect(readFileSync(filePath, 'utf8')).toBe(
      'up three\nup two\nup one\nnew target\ndown one\ndown two\ndown three\nlive tail\n'
    );
    expect(result).toMatchObject({
      relocation: { ranges: [{ from: { start: 4, end: 4 }, to: { start: 4, end: 4 } }] },
    });
  });

  it('多个 PUT 的窗口发生不同位移时分别重定位并原子落盘', async () => {
    const original =
      'far top\na up three\na up two\na up one\nold a\na down one\na down two\na down three\ngap one\ngap two\ngap three\ngap four\nb up three\nb up two\nb up one\nold b\nb down one\nb down two\nb down three\nend\n';
    const live =
      'external prefix\nfar top\na up three\na up two\na up one\nold a\na down one\na down two\na down three\nb up three\nb up two\nb up one\nold b\nb down one\nb down two\nb down three\nend\n';
    const patch = 'PUT 5.=5:\n+new a\nPUT 16.=16:\n+new b';

    const result = await applyStalePatch(original, live, patch);

    expect(readFileSync(filePath, 'utf8')).toBe(
      'external prefix\nfar top\na up three\na up two\na up one\nnew a\na down one\na down two\na down three\nb up three\nb up two\nb up one\nnew b\nb down one\nb down two\nb down three\nend\n'
    );
    expect(result).toMatchObject({
      relocation: {
        ranges: [
          { from: { start: 5, end: 5 }, to: { start: 6, end: 6 } },
          { from: { start: 16, end: 16 }, to: { start: 13, end: 13 } },
        ],
      },
    });
  });

  it('多个 PUT 的上下文窗口重叠时合并为一个定位组迁移', async () => {
    const original =
      'far top\ngroup start\nshared one\nbefore a\nold a\nshared two\nmiddle\nbefore b\nold b\nafter b\nshared three\ngroup end\noriginal tail\n';
    const live =
      'external prefix\nfar top\ngroup start\nshared one\nbefore a\nold a\nshared two\nmiddle\nbefore b\nold b\nafter b\nshared three\ngroup end\nlive tail\n';
    const patch = 'PUT 5.=5:\n+new a\nPUT 9.=9:\n+new b';

    const result = await applyStalePatch(original, live, patch);

    expect(readFileSync(filePath, 'utf8')).toBe(
      'external prefix\nfar top\ngroup start\nshared one\nbefore a\nnew a\nshared two\nmiddle\nbefore b\nnew b\nafter b\nshared three\ngroup end\nlive tail\n'
    );
    expect(result).toMatchObject({
      relocation: {
        ranges: [
          { from: { start: 5, end: 5 }, to: { start: 6, end: 6 } },
          { from: { start: 9, end: 9 }, to: { start: 10, end: 10 } },
        ],
      },
    });
  });

  it('多个 PUT 中任一目标已被外部修改时拒绝整个文件且不落盘', async () => {
    const original =
      'far top\na up three\na up two\na up one\nold a\na down one\na down two\na down three\ngap one\ngap two\ngap three\ngap four\nb up three\nb up two\nb up one\nold b\nb down one\nb down two\nb down three\nend\n';
    const live =
      'external prefix\nfar top\na up three\na up two\na up one\nold a\na down one\na down two\na down three\nb up three\nb up two\nb up one\nexternally changed b\nb down one\nb down two\nb down three\nend\n';
    const patch = 'PUT 5.=5:\n+new a\nPUT 16.=16:\n+new b';

    await expect(applyStalePatch(original, live, patch)).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it.each([
    {
      conflict: '目标块内部新增了行',
      original:
        'far\nup three\nup two\nup one\ntarget one\ntarget two\ndown one\ndown two\ndown three\ntail\n',
      live: 'far\nup three\nup two\nup one\ntarget one\ninserted inside\ntarget two\ndown one\ndown two\ndown three\ntail\n',
      patch: 'PUT 5.=6:\n+replacement',
    },
    {
      conflict: '目标行已被删除',
      original: 'far\nup three\nup two\nup one\ntarget\ndown one\ndown two\ndown three\ntail\n',
      live: 'far\nup three\nup two\nup one\ndown one\ndown two\ndown three\ntail\n',
      patch: 'PUT 5.=5:\n+replacement',
    },
    {
      conflict: '磁盘中存在按尾空白和 BOM 归一后重复的窗口',
      original:
        '\uFEFFup three\nup two \nup one\nold target\ndown one\ndown two \t\ndown three\noriginal tail\n',
      live: '\uFEFFup three\nup two \nup one\nold target\ndown one\ndown two \t\ndown three\nseparator\nup three \nup two\nup one\nold target \ndown one\ndown two\ndown three \n',
      patch: 'PUT 4.=4:\n+replacement',
    },
  ])('$conflict时拒绝恢复且不落盘', async ({ original, live, patch }) => {
    await expect(applyStalePatch(original, live, patch)).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it('快照末行是无换行空白且磁盘已删除该行时拒绝且不落盘', async () => {
    const live = 'x\na\nb\nc\n';

    await expect(applyStalePatch('a\n ', live, 'PUT 2.=2:\n+REPLACED')).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it('快照末行是无换行空白且磁盘仍保留该行时只替换该目标', async () => {
    const result = await applyStalePatch('a\n ', 'x\na\n ', 'PUT 2.=2:\n+REPLACED');

    expect(readFileSync(filePath, 'utf8')).toBe('x\na\nREPLACED');
    expect(result).toMatchObject({
      relocation: {
        ranges: [{ from: { start: 2, end: 2 }, to: { start: 3, end: 3 } }],
      },
    });
  });

  it('旧标签恢复后的补丁与当前目标相同时拒绝且不落盘', async () => {
    const original =
      'up three\nup two\nup one\ntarget\ndown one\ndown two\ndown three\noriginal tail\n';
    const live = 'up three\nup two\nup one\ntarget\ndown one\ndown two\ndown three\nlive tail\n';

    await expect(applyStalePatch(original, live, 'PUT 4.=4:\n+target')).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it('旧快照中的定位窗口重复时即使磁盘只剩一份也拒绝恢复', async () => {
    const group = 'up three\nup two\nup one\ntarget\ndown one\ndown two\ndown three\n';
    const original = `${group}separator\n${group}tail\n`;
    const live = `${group}live tail\n`;

    await expect(applyStalePatch(original, live, 'PUT 4.=4:\n+replacement')).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it('目标未变但三行窗口内的邻居变化时拒绝恢复', async () => {
    const original =
      'far\nup three\nup two\nup one\ntarget\ndown one\ndown two\ndown three\ntail\n';
    const live =
      'far\nup three\nexternally changed neighbor\nup one\ntarget\ndown one\ndown two\ndown three\ntail\n';

    await expect(applyStalePatch(original, live, 'PUT 5.=5:\n+replacement')).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it('多个定位组在磁盘中的顺序反转时拒绝整个文件且不落盘', async () => {
    const groupA = 'a up three\na up two\na up one\nold a\na down one\na down two\na down three\n';
    const groupB = 'b up three\nb up two\nb up one\nold b\nb down one\nb down two\nb down three\n';
    const gap = 'gap one\ngap two\ngap three\ngap four\n';
    const original = `${groupA}${gap}${groupB}`;
    const live = `${groupB}${gap}${groupA}`;

    await expect(
      applyStalePatch(original, live, 'PUT 4.=4:\n+new a\nPUT 15.=15:\n+new b')
    ).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it.each([
    ['畸形', 'PUT nope\n+replacement'],
    ['重叠', 'PUT 2.=3:\n+new two\n+new three\nPUT 3.=3:\n+again'],
    ['按原快照越界', 'PUT 5.=5:\n+replacement'],
  ])('磁盘已偏移时仍拒绝%s PUT 且不落盘', async (_kind, patch) => {
    const original = 'one\ntwo\nthree\nfour\n';
    const live = 'external\none\ntwo\nthree\nfour\n';

    await expect(applyStalePatch(original, live, patch)).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(live);
  });

  it('fresh 写入前第二次读取发现 raw 内容变化时拒绝且不覆盖', async () => {
    const original = 'before\nold target\nafter\n';
    const changed = 'before\r\nold target\r\nafter\r\n';

    await expect(
      applyWhileDiskChanges(original, original, changed, 'PUT 2.=2:\n+replacement')
    ).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(changed);
  });

  it('stale 恢复写入前第二次读取发现 hash 等价但 raw 变化时拒绝且不覆盖', async () => {
    const original =
      'up three\nup two\nup one\nold target\ndown one\ndown two\ndown three\noriginal tail\n';
    const initial =
      'up three\nup two\nup one\nold target\ndown one\ndown two\ndown three\nlive tail\n';
    const changed =
      'up three\nup two\nup one\nold target\ndown one\ndown two\ndown three\nlive tail   \n';

    await expect(
      applyWhileDiskChanges(original, initial, changed, 'PUT 4.=4:\n+replacement')
    ).rejects.toThrow();
    expect(readFileSync(filePath, 'utf8')).toBe(changed);
  });

  it('缺少文件头时拒绝且不写入', async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(
      applyHashlineToFile({
        store: new InMemorySnapshotStore(),
        readText: async () => 'world\n',
        writeText,
        input: 'PUT 1.=1:\n+hello',
      })
    ).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('标签未记录时拒绝且不写入', async () => {
    const writeText = vi.fn(async () => undefined);
    const live = 'world\n';
    await expect(
      applyHashlineToFile({
        store: new InMemorySnapshotStore(),
        readText: async () => live,
        writeText,
        input: inputFor('/tmp/a.ts', computeFileHash(live)),
      })
    ).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('磁盘中的目标内容已冲突时拒绝且不写入', async () => {
    const path = '/tmp/a.ts';
    const store = new InMemorySnapshotStore();
    const tag = store.record(path, 'old\n');
    const writeText = vi.fn(async () => undefined);
    await expect(
      applyHashlineToFile({
        store,
        readText: async () => 'changed\n',
        writeText,
        input: inputFor(path, tag),
      })
    ).rejects.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });
});
