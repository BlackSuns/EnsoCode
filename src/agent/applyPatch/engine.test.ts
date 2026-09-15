import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalApplyPatchIo,
  executeApplyPatch,
  normalizePatchPath,
  type PatchIo,
  PatchMutationUncertainError,
  validateApplyPatchTargets,
} from './index';

const patch = (...body: string[]) => ({
  input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n'),
});

let cwd: string;
beforeEach(async () => {
  cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'enso-apply-patch-')));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function text(relative: string): Promise<string> {
  return readFile(path.join(cwd, relative), 'utf8');
}

describe('apply_patch 引擎', () => {
  it('一次预检后执行多文件 add/update/delete', async () => {
    await writeFile(path.join(cwd, 'update.txt'), 'one\ntwo\n');
    await writeFile(path.join(cwd, 'delete.txt'), 'gone\n');
    const result = await executeApplyPatch(
      cwd,
      patch(
        '*** Add File: nested/add.txt',
        '+added',
        '*** Update File: update.txt',
        '@@',
        '-two',
        '+changed',
        '*** Delete File: delete.txt'
      )
    );
    expect(result.details).toMatchObject({
      kind: 'apply_patch',
      status: 'success',
      applied: ['nested/add.txt', 'update.txt', 'delete.txt'],
      uncertain: [],
    });
    expect(await text('nested/add.txt')).toBe('added\n');
    expect(await text('update.txt')).toBe('one\nchanged\n');
    await expect(text('delete.txt')).rejects.toThrow();
  });

  it('Update 中只有上下文的定位 hunk 被忽略，实质改动仍写入', async () => {
    await writeFile(path.join(cwd, 'update.txt'), 'one\ntwo\nthree\n');
    await executeApplyPatch(
      cwd,
      patch('*** Update File: update.txt', '@@', ' one', '@@', '-two', '+changed', '@@', ' three')
    );
    expect(await text('update.txt')).toBe('one\nchanged\nthree\n');
  });

  it('move 先独占写目标再删除源，并按两个物理路径报告', async () => {
    await writeFile(path.join(cwd, 'old.txt'), 'old\n');
    const result = await executeApplyPatch(
      cwd,
      patch('*** Update File: old.txt', '*** Move to: new/renamed.txt', '@@', '-old', '+new')
    );
    expect(result.details.fileChanges).toEqual([
      { path: 'new/renamed.txt', oldText: '', newText: 'new\n', type: 'add' },
      { path: 'old.txt', oldText: 'old\n', newText: '', type: 'delete' },
    ]);
    expect(await text('new/renamed.txt')).toBe('new\n');
    await expect(text('old.txt')).rejects.toThrow();
  });

  it('新增内容含 NUL 时在 preflight 拒绝且保持 0 写', async () => {
    await expect(
      executeApplyPatch(cwd, patch('*** Add File: binary.txt', '+safe\0unsafe'))
    ).rejects.toThrow(/binary/i);
    await expect(text('binary.txt')).rejects.toThrow();
  });

  it('Update 生成内容含 NUL 时同样在 preflight 拒绝', async () => {
    await writeFile(path.join(cwd, 'text.txt'), 'old\n');
    await expect(
      executeApplyPatch(cwd, patch('*** Update File: text.txt', '@@', '-old', '+new\0binary'))
    ).rejects.toThrow(/binary/i);
    expect(await text('text.txt')).toBe('old\n');
  });

  it('Update 生成文件超过单文件预算时在写入前拒绝', async () => {
    await writeFile(path.join(cwd, 'limit.txt'), Buffer.alloc(4 * 1024 * 1024, 0x61));
    await expect(
      executeApplyPatch(cwd, patch('*** Update File: limit.txt', '@@', '+extra', '*** End of File'))
    ).rejects.toThrow(/limit/i);
    expect((await readFile(path.join(cwd, 'limit.txt'))).length).toBe(4 * 1024 * 1024);
  });

  it('规范路径存在祖先冲突时 preflight 拒绝且保持 0 写', async () => {
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Add File: node', '+file', '*** Add File: node/child.txt', '+child')
      )
    ).rejects.toThrow(/ancestor/i);
    await expect(text('node')).rejects.toThrow();
  });

  it('祖先冲突检测不受中间字典序路径绕过', async () => {
    await expect(
      executeApplyPatch(
        cwd,
        patch(
          '*** Add File: a',
          '+parent',
          '*** Add File: a.b',
          '+sibling',
          '*** Add File: a/b',
          '+child'
        )
      )
    ).rejects.toThrow(/ancestor/i);
    for (const target of ['a', 'a.b', 'a/b']) await expect(text(target)).rejects.toThrow();
  });

  it('大小写别名及其祖先组合在 preflight 保守拒绝', async () => {
    for (const params of [
      patch('*** Add File: A', '+upper', '*** Add File: a', '+lower'),
      patch('*** Add File: Dir', '+parent', '*** Add File: dir/child', '+child'),
    ]) {
      await expect(executeApplyPatch(cwd, params)).rejects.toThrow(/alias|ancestor/i);
    }
    for (const target of ['A', 'a', 'Dir', 'dir']) await expect(text(target)).rejects.toThrow();
  });

  it('后文件预检冲突时前文件保持 0 写', async () => {
    await writeFile(path.join(cwd, 'exists.txt'), 'keep\n');
    await expect(
      executeApplyPatch(
        cwd,
        patch(
          '*** Add File: first.txt',
          '+would write',
          '*** Add File: exists.txt',
          '+must conflict'
        )
      )
    ).rejects.toThrow();
    await expect(text('first.txt')).rejects.toThrow();
    expect(await text('exists.txt')).toBe('keep\n');
  });

  it.each(['../outside.txt', 'nested/../../outside.txt'])('拒绝相对逃逸路径 %s', async (target) => {
    await expect(
      validateApplyPatchTargets(cwd, patch(`*** Add File: ${target}`, '+x'))
    ).rejects.toThrow();
  });

  it('允许显式外部绝对路径执行 add/update/delete', async () => {
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'enso-patch-absolute-')));
    try {
      const added = path.join(outside, 'nested/add.txt');
      const updated = path.join(outside, 'update.txt');
      const deleted = path.join(outside, 'delete.txt');
      await writeFile(updated, 'before\n');
      await writeFile(deleted, 'gone\n');

      const result = await executeApplyPatch(
        cwd,
        patch(
          `*** Add File: ${added}`,
          '+added',
          `*** Update File: ${updated}`,
          '@@',
          '-before',
          '+after',
          `*** Delete File: ${deleted}`
        )
      );

      expect(result.details.applied).toEqual([added, updated, deleted]);
      expect(await readFile(added, 'utf8')).toBe('added\n');
      expect(await readFile(updated, 'utf8')).toBe('after\n');
      await expect(readFile(deleted, 'utf8')).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('显式绝对路径可作为 move 目标且仍按两个物理路径报告', async () => {
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'enso-patch-move-')));
    try {
      await writeFile(path.join(cwd, 'source.txt'), 'source\n');
      const target = path.join(outside, 'target.txt');
      const result = await executeApplyPatch(
        cwd,
        patch('*** Update File: source.txt', `*** Move to: ${target}`)
      );
      expect(result.details.applied).toEqual([target, 'source.txt']);
      expect(await readFile(target, 'utf8')).toBe('source\n');
      await expect(text('source.txt')).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('显式绝对路径可作为 move 源并移动到工作区相对目标', async () => {
    const outside = await realpath(
      await mkdtemp(path.join(os.tmpdir(), 'enso-patch-move-source-'))
    );
    const source = path.join(outside, 'source.txt');
    try {
      await writeFile(source, 'source\n');
      const result = await executeApplyPatch(
        cwd,
        patch(`*** Update File: ${source}`, '*** Move to: moved/target.txt')
      );
      expect(result.details.applied).toEqual(['moved/target.txt', source]);
      expect(await text('moved/target.txt')).toBe('source\n');
      await expect(readFile(source, 'utf8')).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('外部绝对目标后置冲突时工作区内前序目标保持零写', async () => {
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'enso-patch-preflight-')));
    const existing = path.join(outside, 'existing.txt');
    try {
      await writeFile(existing, 'keep\n');
      await expect(
        executeApplyPatch(
          cwd,
          patch('*** Add File: first.txt', '+first', `*** Add File: ${existing}`, '+conflict')
        )
      ).rejects.toThrow(/already exists/i);
      await expect(text('first.txt')).rejects.toThrow();
      expect(await readFile(existing, 'utf8')).toBe('keep\n');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('相对与绝对路径指向同一文件时在写入前拒绝', async () => {
    const absolute = path.join(cwd, 'alias.txt');
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Add File: alias.txt', '+relative', `*** Add File: ${absolute}`, '+absolute')
      )
    ).rejects.toThrow(/same target|more than once|alias/i);
    await expect(text('alias.txt')).rejects.toThrow();
  });

  it('相对目录与其绝对子路径构成祖先冲突时保持零写', async () => {
    const child = path.join(cwd, 'node/child.txt');
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Add File: node', '+parent', `*** Add File: ${child}`, '+child')
      )
    ).rejects.toThrow(/ancestor/i);
    await expect(text('node')).rejects.toThrow();
  });

  it('绝对目录在前、相对子路径在后时同样识别跨表示祖先冲突', async () => {
    const parent = path.join(cwd, 'reverse-node');
    await expect(
      executeApplyPatch(
        cwd,
        patch(
          `*** Add File: ${parent}`,
          '+parent',
          '*** Add File: reverse-node/child.txt',
          '+child'
        )
      )
    ).rejects.toThrow(/ancestor/i);
    await expect(text('reverse-node')).rejects.toThrow();
  });

  it('Move 两端以相对和绝对路径指向同一文件时保持源文件不变', async () => {
    const absolute = path.join(cwd, 'move-alias.txt');
    await writeFile(absolute, 'keep\n');
    await expect(
      executeApplyPatch(cwd, patch('*** Update File: move-alias.txt', `*** Move to: ${absolute}`))
    ).rejects.toThrow(/same target|alias/i);
    expect(await text('move-alias.txt')).toBe('keep\n');
  });

  it.each([
    ['大小写', 'Case-Alias.txt', 'case-alias.txt'],
    ['NFC', 'café-alias.txt', 'café-alias.txt'],
  ])('canonical 统一后仍保守拒绝%s别名', async (_kind, relative, absoluteName) => {
    const absolute = path.join(cwd, absoluteName);
    await expect(
      executeApplyPatch(
        cwd,
        patch(`*** Add File: ${relative}`, '+relative', `*** Add File: ${absolute}`, '+absolute')
      )
    ).rejects.toThrow(/alias|same target/i);
    await expect(text(relative)).rejects.toThrow();
    await expect(readFile(absolute, 'utf8')).rejects.toThrow();
  });

  it('外部绝对路径的 leaf 和父目录符号链接仍拒绝', async () => {
    const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'enso-patch-link-')));
    const actual = path.join(outside, 'actual');
    await mkdir(actual);
    await writeFile(path.join(actual, 'victim.txt'), 'safe\n');
    await symlink(actual, path.join(outside, 'linked'));
    await symlink(path.join(actual, 'victim.txt'), path.join(outside, 'leaf.txt'));
    try {
      await expect(
        executeApplyPatch(
          cwd,
          patch(
            `*** Update File: ${path.join(outside, 'linked/victim.txt')}`,
            '@@',
            '-safe',
            '+bad'
          )
        )
      ).rejects.toThrow(/symbolic|symlink|unsafe/i);
      await expect(
        executeApplyPatch(cwd, patch(`*** Delete File: ${path.join(outside, 'leaf.txt')}`))
      ).rejects.toThrow(/symbolic|symlink|unsafe/i);
      expect(await readFile(path.join(actual, 'victim.txt'), 'utf8')).toBe('safe\n');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('POSIX 不把 Windows 盘符或 UNC 当作工作区相对路径', async () => {
    if (process.platform === 'win32') return;
    for (const target of [
      'C:/outside.txt',
      String.raw`\root-relative.txt`,
      String.raw`\\server\share\outside.txt`,
    ]) {
      await expect(
        validateApplyPatchTargets(cwd, patch(`*** Add File: ${target}`, '+x'))
      ).rejects.toThrow();
    }
  });

  it('Windows 域仅接受完整盘符绝对路径，拒绝 root-relative、drive-relative 与 UNC', () => {
    expect(normalizePatchPath('C:/outside.txt', 'win32')).toBe('C:\\outside.txt');
    expect(normalizePatchPath('nested/file.txt', 'win32')).toBe('nested\\file.txt');
    for (const target of [
      String.raw`\root-relative.txt`,
      '/root-relative.txt',
      'C:drive-relative.txt',
      String.raw`\\server\share\outside.txt`,
      '//server/share/outside.txt',
    ]) {
      expect(() => normalizePatchPath(target, 'win32')).toThrow();
    }
  });

  it('拒绝 leaf/父目录符号链接，cwd 自身为系统临时链接不受影响', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'enso-apply-outside-'));
    try {
      await writeFile(path.join(outside, 'victim.txt'), 'safe\n');
      await symlink(outside, path.join(cwd, 'linked'));
      await symlink(path.join(outside, 'victim.txt'), path.join(cwd, 'leaf.txt'));
      await expect(
        executeApplyPatch(cwd, patch('*** Update File: linked/victim.txt', '@@', '-safe', '+bad'))
      ).rejects.toThrow();
      await expect(executeApplyPatch(cwd, patch('*** Delete File: leaf.txt'))).rejects.toThrow();
      expect(await readFile(path.join(outside, 'victim.txt'), 'utf8')).toBe('safe\n');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('小文件 snapshot 不保留 maxBytes 大缓冲区', async () => {
    await writeFile(path.join(cwd, 'tiny.txt'), 'x');
    const entry = await createLocalApplyPatchIo(cwd).inspect('tiny.txt', 4 * 1024 * 1024);
    expect(entry.raw?.length).toBe(1);
    expect(entry.raw?.buffer.byteLength).toBe(1);
  });

  it('大量短行更新不使用参数展开导致 RangeError', async () => {
    const manyLines = `unique\n${'x\n'.repeat(200_000)}`;
    await writeFile(path.join(cwd, 'many-lines.txt'), manyLines);
    const result = await executeApplyPatch(
      cwd,
      patch('*** Update File: many-lines.txt', '@@', '-unique', '+changed')
    );
    expect(result.details.status).toBe('success');
    expect((await text('many-lines.txt')).startsWith('changed\nx\n')).toBe(true);
  });

  it('拒绝目录、二进制、无效 UTF-8 与超限文件', async () => {
    await mkdir(path.join(cwd, 'directory'));
    await writeFile(path.join(cwd, 'binary.bin'), Buffer.from([0x61, 0, 0x62]));
    await writeFile(path.join(cwd, 'invalid.txt'), Buffer.from([0xff]));
    await writeFile(path.join(cwd, 'large.txt'), Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    for (const target of ['directory', 'binary.bin', 'invalid.txt', 'large.txt']) {
      await expect(executeApplyPatch(cwd, patch(`*** Delete File: ${target}`))).rejects.toThrow();
    }
  });

  it('拒绝规范化后重复路径及 move 别名冲突', async () => {
    await writeFile(path.join(cwd, 'a.txt'), 'a\n');
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Update File: a.txt', '*** Move to: dir/../b.txt', '*** Add File: b.txt', '+b')
      )
    ).rejects.toThrow();
    expect(await text('a.txt')).toBe('a\n');
  });

  it('exact 和 trimEnd 每级都要求唯一，EOF 必须命中结尾', async () => {
    await writeFile(path.join(cwd, 'a.txt'), 'same\nsame\ntail\n');
    await expect(
      executeApplyPatch(cwd, patch('*** Update File: a.txt', '@@', '-same', '+changed'))
    ).rejects.toThrow(/ambiguous/i);
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Update File: a.txt', '@@', '-same', '+changed', '*** End of File')
      )
    ).rejects.toThrow();
    expect(await text('a.txt')).toBe('same\nsame\ntail\n');
  });

  it('非空 anchor 尾空白不归一，避免命中错误代码块', async () => {
    await writeFile(path.join(cwd, 'anchor-space.txt'), 'anchor  \nsame\nanchor\nsame\n');
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Update File: anchor-space.txt', '@@ anchor  ', '-same', '+changed')
      )
    ).rejects.toThrow(/ambiguous/i);
    expect(await text('anchor-space.txt')).toBe('anchor  \nsame\nanchor\nsame\n');
  });

  it('anchor 与 EOF 必须同时满足，不能越过 anchor 向前匹配', async () => {
    await writeFile(path.join(cwd, 'anchor-eof.txt'), 'a\nanchor\n');
    await expect(
      executeApplyPatch(
        cwd,
        patch(
          '*** Update File: anchor-eof.txt',
          '@@ anchor',
          '-a',
          '-anchor',
          '+x',
          '*** End of File'
        )
      )
    ).rejects.toThrow();
    await expect(
      executeApplyPatch(
        cwd,
        patch('*** Update File: anchor-eof.txt', '@@ a', '+x', '*** End of File')
      )
    ).rejects.toThrow();
    expect(await text('anchor-eof.txt')).toBe('a\nanchor\n');
  });

  it('EOF chunk 只匹配原文件结尾并保留无最终换行状态', async () => {
    await writeFile(path.join(cwd, 'eof.txt'), 'head\nold');
    await executeApplyPatch(
      cwd,
      patch('*** Update File: eof.txt', '@@', '-old', '+new', '*** End of File')
    );
    expect(await text('eof.txt')).toBe('head\nnew');
  });

  it('纯新增只允许空文件、anchor 后或显式 EOF，不猜中间位置', async () => {
    await writeFile(path.join(cwd, 'nonempty.txt'), 'head\n');
    await expect(
      executeApplyPatch(cwd, patch('*** Update File: nonempty.txt', '@@', '+guess'))
    ).rejects.toThrow();
    const eof = await executeApplyPatch(
      cwd,
      patch('*** Update File: nonempty.txt', '@@', '+tail', '*** End of File')
    );
    expect(eof.details.status).toBe('success');
    expect(await text('nonempty.txt')).toBe('head\ntail\n');
    await writeFile(path.join(cwd, 'empty.txt'), '');
    await executeApplyPatch(cwd, patch('*** Update File: empty.txt', '@@', '+only'));
    expect(await text('empty.txt')).toBe('only');
  });

  it('多 chunk 都按原文件坐标定位，允许上下文重叠但修改区间不重叠', async () => {
    await writeFile(path.join(cwd, 'chunks.txt'), 'a\nold1\nshared\nold2\nz\n');
    await executeApplyPatch(
      cwd,
      patch(
        '*** Update File: chunks.txt',
        '@@',
        ' a',
        '-old1',
        '+new1',
        ' shared',
        '@@',
        ' shared',
        '-old2',
        '+new2',
        ' z'
      )
    );
    expect(await text('chunks.txt')).toBe('a\nnew1\nshared\nnew2\nz\n');
  });

  it('保留 BOM、未变行尾空白、混合 EOL 和无最终换行状态', async () => {
    await writeFile(path.join(cwd, 'mixed.txt'), Buffer.from('\uFEFFkeep  \r\nold\nlast', 'utf8'));
    await executeApplyPatch(
      cwd,
      patch('*** Update File: mixed.txt', '@@', ' keep', '-old', '+new', ' last')
    );
    expect(await readFile(path.join(cwd, 'mixed.txt'))).toEqual(
      Buffer.from('\uFEFFkeep  \r\nnew\r\nlast', 'utf8')
    );
  });

  it('目标写失败时 move 不删除源；已完成步骤与未尝试步骤如实报告', async () => {
    await writeFile(path.join(cwd, 'old.txt'), 'old\n');
    const base = createLocalApplyPatchIo(cwd);
    const io: PatchIo = {
      ...base,
      async write(target, raw, options) {
        if (target === 'new.txt') throw new Error('injected write failure');
        await base.write(target, raw, options);
      },
    };
    const result = await executeApplyPatch(
      cwd,
      patch('*** Update File: old.txt', '*** Move to: new.txt'),
      { io }
    );
    expect(result.details).toMatchObject({
      status: 'failed',
      applied: [],
      failed: ['new.txt'],
      unattempted: ['old.txt'],
    });
    expect(await text('old.txt')).toBe('old\n');
    await expect(text('new.txt')).rejects.toThrow();
  });

  it('途中 IO 失败时只报告已真实成功文件，其余不尝试', async () => {
    const base = createLocalApplyPatchIo(cwd);
    const io: PatchIo = {
      ...base,
      async write(target, raw, options) {
        if (target === 'second.txt') throw new Error('injected midway failure');
        await base.write(target, raw, options);
      },
    };
    const result = await executeApplyPatch(
      cwd,
      patch(
        '*** Add File: first.txt',
        '+one',
        '*** Add File: second.txt',
        '+two',
        '*** Add File: third.txt',
        '+three'
      ),
      { io }
    );
    expect(result.details).toMatchObject({
      status: 'partial',
      applied: ['first.txt'],
      failed: ['second.txt'],
      unattempted: ['third.txt'],
      uncertain: [],
    });
    expect(await text('first.txt')).toBe('one\n');
    await expect(text('third.txt')).rejects.toThrow();
  });

  it('写命令报错且 readback 无法判定时只列 uncertain，不展示意图 diff', async () => {
    const base = createLocalApplyPatchIo(cwd);
    const io: PatchIo = {
      ...base,
      async write(target, _raw, options) {
        await base.write(target, Buffer.from('partial'), options);
        throw new Error('connection lost');
      },
    };
    const result = await executeApplyPatch(cwd, patch('*** Add File: uncertain.txt', '+complete'), {
      io,
    });
    expect(result.details).toMatchObject({
      status: 'failed',
      fileChanges: [],
      failed: [],
      uncertain: ['uncertain.txt'],
    });
    expect(await text('uncertain.txt')).toBe('partial');
  });

  it('move 目标成功但源删除失败时只报告目标 add，且源仍在', async () => {
    await writeFile(path.join(cwd, 'source.txt'), 'source\n');
    const base = createLocalApplyPatchIo(cwd);
    const io: PatchIo = {
      ...base,
      async remove() {
        throw new Error('injected delete failure');
      },
    };
    const result = await executeApplyPatch(
      cwd,
      patch('*** Update File: source.txt', '*** Move to: target.txt'),
      { io }
    );
    expect(result.details).toMatchObject({
      status: 'partial',
      applied: ['target.txt'],
      failed: ['source.txt'],
    });
    expect(result.details.fileChanges).toEqual([
      { path: 'target.txt', oldText: '', newText: 'source\n', type: 'add' },
    ]);
    expect(await text('source.txt')).toBe('source\n');
    expect(await text('target.txt')).toBe('source\n');
  });

  it('动作级最后复核期间取消时不开始 mutation', async () => {
    const controller = new AbortController();
    const base = createLocalApplyPatchIo(cwd);
    let inspections = 0;
    let wrote = false;
    const io: PatchIo = {
      ...base,
      async inspect(target, maxBytes, signal) {
        const entry = await base.inspect(target, maxBytes, signal);
        inspections += 1;
        if (inspections === 3) controller.abort();
        return entry;
      },
      async write() {
        wrote = true;
      },
    };
    const result = await executeApplyPatch(cwd, patch('*** Add File: cancelled.txt', '+no'), {
      io,
      signal: controller.signal,
    });
    expect(wrote).toBe(false);
    expect(result.details).toMatchObject({
      status: 'failed',
      applied: [],
      failed: [],
      unattempted: ['cancelled.txt'],
      uncertain: [],
    });
  });

  it('SSH transport 不确定错误不立即 readback 降级为 unchanged', async () => {
    let inspections = 0;
    const io: PatchIo = {
      async inspect(target) {
        inspections += 1;
        return { kind: 'missing', canonicalPath: path.join(cwd, target) };
      },
      async write() {
        throw new PatchMutationUncertainError('ssh command aborted');
      },
      async remove() {},
    };
    const result = await executeApplyPatch(cwd, patch('*** Add File: remote.txt', '+unknown'), {
      io,
    });
    expect(inspections).toBe(3);
    expect(result.details).toMatchObject({
      status: 'failed',
      failed: [],
      uncertain: ['remote.txt'],
    });
  });

  it('readback 使用独立短 timeout', async () => {
    const timeouts: Array<number | undefined> = [];
    let inspections = 0;
    const io: PatchIo = {
      async inspect(target, _maxBytes, _signal, timeoutMs) {
        inspections += 1;
        timeouts.push(timeoutMs);
        return { kind: 'missing', canonicalPath: path.join(cwd, target) };
      },
      async write() {
        throw new Error('confirmed failure');
      },
      async remove() {},
    };
    const result = await executeApplyPatch(cwd, patch('*** Add File: failed.txt', '+x'), { io });
    expect(result.details.failed).toEqual(['failed.txt']);
    expect(inspections).toBe(4);
    expect(timeouts.at(-1)).toBe(5_000);
  });

  it('取消发生在写入后时保留真实完成清单', async () => {
    const controller = new AbortController();
    const base = createLocalApplyPatchIo(cwd);
    const io: PatchIo = {
      ...base,
      async write(target, raw, options) {
        await base.write(target, raw, options);
        if (target === 'first.txt') controller.abort();
      },
    };
    const result = await executeApplyPatch(
      cwd,
      patch('*** Add File: first.txt', '+one', '*** Add File: second.txt', '+two'),
      { io, signal: controller.signal }
    );
    expect(result.details).toMatchObject({
      status: 'partial',
      applied: ['first.txt'],
      unattempted: ['second.txt'],
    });
    expect(await text('first.txt')).toBe('one\n');
    await expect(text('second.txt')).rejects.toThrow();
  });

  it('所有 patch 共用一份执行队列，避免并发预检覆盖', async () => {
    await writeFile(path.join(cwd, 'serial.txt'), 'one\n');
    const first = executeApplyPatch(
      cwd,
      patch('*** Update File: serial.txt', '@@', '-one', '+two')
    );
    const second = executeApplyPatch(
      cwd,
      patch('*** Update File: serial.txt', '@@', '-two', '+three')
    );
    expect((await first).details.status).toBe('success');
    expect((await second).details.status).toBe('success');
    expect(await text('serial.txt')).toBe('three\n');
  });
});
