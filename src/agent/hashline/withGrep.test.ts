import { describe, expect, it, vi } from 'vitest';
import { computeFileHash, formatHashlineHeader } from './format';
import { InMemorySnapshotStore } from './snapshots';
import { withHashlineGrep } from './withGrep';

const fakeGrep = (text: string) => ({
  name: 'grep',
  async execute(_id: string, _params: unknown) {
    return { content: [{ type: 'text', text }] };
  },
});

describe('withHashlineGrep', () => {
  it('命中文件时记录完整文本并在结果中加入标签文件头', async () => {
    const path = 'src/a.ts';
    const body = 'first\nmatch line\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async () => body);
    const grep = withHashlineGrep(fakeGrep(`${path}:2:match line`), store, readFileText);
    const result = await grep.execute('call-1', { pattern: 'match' });
    const visible = result.content[0]?.text ?? '';
    expect(readFileText).toHaveBeenCalledWith(path);
    expect(store.get(path, computeFileHash(body))).toBe(body);
    expect(visible).toContain(formatHashlineHeader(path, computeFileHash(body)));
  });

  it('空结果与无匹配提示都不读取或记录文件', async () => {
    const store = new InMemorySnapshotStore();
    const record = vi.spyOn(store, 'record');
    const readFileText = vi.fn(async () => 'unused');
    await withHashlineGrep(fakeGrep(''), store, readFileText).execute('call-2', {});
    await withHashlineGrep(fakeGrep('No matches found'), store, readFileText).execute('call-3', {});
    expect(readFileText).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('命中文件不可读时保留无标签结果且不让整个 grep 失败', async () => {
    const path = 'src/missing.ts';
    const output = `${path}:3:match line`;
    const store = new InMemorySnapshotStore();
    const record = vi.spyOn(store, 'record');
    const grep = withHashlineGrep(fakeGrep(output), store, async () => undefined);
    await expect(grep.execute('call-4', {})).resolves.toEqual({
      content: [{ type: 'text', text: output }],
    });
    expect(record).not.toHaveBeenCalled();
  });

  it('默认 cwd 搜索保持 grep 相对路径作为文件头和命中路径', async () => {
    const body = 'cwd hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === 'src/a.ts' ? body : undefined
    );
    const grep = withHashlineGrep(fakeGrep('src/a.ts:1:cwd hit'), store, readFileText);
    const result = await grep.execute('cwd', { pattern: 'hit' });
    const text = result.content[0]?.text ?? '';
    expect(readFileText).toHaveBeenCalledWith('src/a.ts');
    expect(text).toBe(
      `${formatHashlineHeader('src/a.ts', computeFileHash(body))}\nsrc/a.ts:1:cwd hit`
    );
  });

  it('子目录搜索把 pi 相对 searchPath 的输出补成真实路径且文件头一致', async () => {
    const body = 'subdir hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === 'src/a.ts' ? body : undefined
    );
    const grep = withHashlineGrep(fakeGrep('a.ts:1:subdir hit'), store, readFileText);
    const result = await grep.execute('subdir', { pattern: 'hit', path: 'src' });
    const text = result.content[0]?.text ?? '';
    expect(readFileText).toHaveBeenCalledWith('src/a.ts');
    expect(text).toBe(
      `${formatHashlineHeader('src/a.ts', computeFileHash(body))}\nsrc/a.ts:1:subdir hit`
    );
  });

  it('绝对目录搜索生成绝对文件头并同步改写命中路径', async () => {
    const body = 'absolute hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === '/repo/src/a.ts' ? body : undefined
    );
    const grep = withHashlineGrep(fakeGrep('a.ts:1:absolute hit'), store, readFileText);
    const result = await grep.execute('absolute-dir', {
      pattern: 'hit',
      path: '/repo/src',
    });
    const text = result.content[0]?.text ?? '';
    expect(readFileText).toHaveBeenCalledWith('/repo/src/a.ts');
    expect(text).toBe(
      `${formatHashlineHeader('/repo/src/a.ts', computeFileHash(body))}\n/repo/src/a.ts:1:absolute hit`
    );
  });

  it('单文件搜索使用 params.path 而不是把 basename 当 cwd 文件', async () => {
    const targetBody = 'target hit\n';
    const cwdCollision = 'wrong hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) => {
      if (filePath === 'nested/a.ts') return targetBody;
      if (filePath === 'a.ts') return cwdCollision;
      return undefined;
    });
    const grep = withHashlineGrep(fakeGrep('a.ts:1:target hit'), store, readFileText);
    const result = await grep.execute('single-file', {
      pattern: 'hit',
      path: 'nested/a.ts',
    });
    const text = result.content[0]?.text ?? '';
    expect(text).toBe(
      `${formatHashlineHeader('nested/a.ts', computeFileHash(targetBody))}\nnested/a.ts:1:target hit`
    );
    expect(store.get('a.ts', computeFileHash(cwdCollision))).toBeUndefined();
  });

  it('basename 歧义时以可读文件语义区分目录与单文件，不猜错同名子文件', async () => {
    const body = 'nested hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === 'fixtures/same.ts/same.ts' ? body : undefined
    );
    const grep = withHashlineGrep(fakeGrep('same.ts:1:nested hit'), store, readFileText);
    const result = await grep.execute('same-name-dir', {
      pattern: 'hit',
      path: 'fixtures/same.ts',
    });
    const text = result.content[0]?.text ?? '';
    expect(readFileText).toHaveBeenCalledWith('fixtures/same.ts');
    expect(readFileText).toHaveBeenCalledWith('fixtures/same.ts/same.ts');
    expect(text).toBe(
      `${formatHashlineHeader('fixtures/same.ts/same.ts', computeFileHash(body))}\nfixtures/same.ts/same.ts:1:nested hit`
    );
  });

  it.each(['无权限', '不存在'])('显式单文件%s时不回退 cwd 同名文件', async () => {
    const cwdCollision = 'wrong hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === 'a.ts' ? cwdCollision : undefined
    );
    const output = 'a.ts:1:target hit';
    const grep = withHashlineGrep(fakeGrep(output), store, readFileText);
    await expect(
      grep.execute('unreadable-single-file', { pattern: 'hit', path: 'nested/a.ts' })
    ).resolves.toEqual({ content: [{ type: 'text', text: output }] });
    expect(readFileText).toHaveBeenCalledWith('nested/a.ts');
    expect(readFileText).toHaveBeenCalledWith('nested/a.ts/a.ts');
    expect(readFileText).not.toHaveBeenCalledWith('a.ts');
    expect(store.get('a.ts', computeFileHash(cwdCollision))).toBeUndefined();
  });

  it('路径自身含 -数字- 时按已解析完整路径重写命中与上下文行', async () => {
    const relative = 'archive/2026-09/09-07-x/a.md';
    const absolute = `/repo/${relative}`;
    const body = 'match\ncontext\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === absolute ? body : undefined
    );
    const grep = withHashlineGrep(
      fakeGrep(`${relative}:1:match\n${relative}-2-context`),
      store,
      readFileText
    );
    const result = await grep.execute('hyphen-number-path', { pattern: 'match', path: '/repo' });
    expect(result.content[0]?.text).toBe(
      `${formatHashlineHeader(absolute, computeFileHash(body))}\n${absolute}:1:match\n${absolute}-2-context`
    );
  });

  it('同源路径前缀冲突时最长文件路径优先', async () => {
    const bodies = new Map([
      ['nested/a', 'first\n'],
      ['nested/a/a-7-b.md', 'second\n'],
    ]);
    const store = new InMemorySnapshotStore();
    const grep = withHashlineGrep(
      fakeGrep('a:1:first\na-7-b.md:1:second'),
      store,
      async (filePath) => bodies.get(filePath)
    );
    const result = await grep.execute('longest-prefix', {
      pattern: 'match',
      path: 'nested/a',
    });
    expect(result.content[0]?.text).toContain('nested/a/a-7-b.md:1:second');
    expect(result.content[0]?.text).not.toContain('nested/a-7-b.md:1:second');
  });

  it('不可读长路径仍遮蔽已解析短前缀，命中行保持原样', async () => {
    const body = 'first\n';
    const store = new InMemorySnapshotStore();
    const grep = withHashlineGrep(
      fakeGrep('a:1:first\na-7-b.md:1:unreadable'),
      store,
      async (filePath) => (filePath === 'nested/a' ? body : undefined)
    );
    const result = await grep.execute('unreadable-long-prefix', {
      pattern: 'match',
      path: 'nested/a',
    });
    expect(result.content[0]?.text).toBe(
      `${formatHashlineHeader('nested/a', computeFileHash(body))}\nnested/a:1:first\na-7-b.md:1:unreadable`
    );
  });

  it('SSH grep 已输出绝对路径时不叠加相对 searchPath', async () => {
    const body = 'remote hit\n';
    const store = new InMemorySnapshotStore();
    const readFileText = vi.fn(async (filePath: string) =>
      filePath === '/work/src/a.ts' ? body : undefined
    );
    const grep = withHashlineGrep(fakeGrep('/work/src/a.ts:1:remote hit'), store, readFileText);
    const result = await grep.execute('ssh', { pattern: 'hit', path: 'src' });
    const text = result.content[0]?.text ?? '';
    expect(readFileText).toHaveBeenCalledWith('/work/src/a.ts');
    expect(text).toBe(
      `${formatHashlineHeader('/work/src/a.ts', computeFileHash(body))}\n/work/src/a.ts:1:remote hit`
    );
  });
});
