import { describe, expect, it } from 'vitest';
import { getApplyPatchPaths, normalizeApplyPatchArguments, parseApplyPatch } from './index';

const envelope = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

describe('apply_patch 参数和语法', () => {
  it('只确定性归一 raw string 和 JSON string，且不丢弃冲突字段', () => {
    const patch = envelope('*** Add File: a.txt\n+a');
    expect(normalizeApplyPatchArguments(patch)).toEqual({ input: patch });
    expect(normalizeApplyPatchArguments(JSON.stringify({ input: patch, path: 'x' }))).toEqual({
      input: patch,
      path: 'x',
    });
    expect(normalizeApplyPatchArguments(JSON.stringify(patch))).toEqual({ input: patch });
  });

  it('解析 add/delete/update/move 与多个 chunk，并由同一 parser 提取全部路径', () => {
    const patch = envelope(
      [
        '*** Add File: add.txt',
        '+hello',
        '*** Delete File: delete.txt',
        '*** Update File: old.txt',
        '*** Move to: nested/new.txt',
        '@@ first',
        '-old',
        '+new',
        '@@',
        ' tail',
        '+after',
      ].join('\n')
    );
    const operations = parseApplyPatch(patch);
    expect(operations).toHaveLength(3);
    expect(operations[2]).toMatchObject({
      type: 'update',
      path: 'old.txt',
      movePath: 'nested/new.txt',
      chunks: [{ changeContext: 'first' }, { oldLines: ['tail'], newLines: ['tail', 'after'] }],
    });
    expect(getApplyPatchPaths({ input: patch })).toEqual([
      'add.txt',
      'delete.txt',
      'old.txt',
      'nested/new.txt',
    ]);
  });

  it.each([
    ['', 'envelope'],
    [envelope(''), 'empty patch'],
    [envelope('*** Update File: a.txt\n@@'), 'empty update'],
    [envelope('*** Update File: a.txt\n@@\n same'), 'noop'],
    [envelope('*** Delete File: a.txt\n+bad'), 'syntax'],
    [envelope('*** Add File: a.txt\nvalue'), 'syntax'],
    [`prefix\n${envelope('*** Add File: a.txt\n+a')}`, 'envelope'],
    [envelope('*** Add File: a.txt\r+a'), 'lone CR'],
  ])('拒绝非法或无效果 patch：%s', (patch) => {
    expect(() => parseApplyPatch(patch)).toThrow();
  });

  it('只标准化 patch 的 CRLF，不接受 shell 包装或 lone CR', () => {
    const crlf = envelope('*** Add File: a.txt\n+x').replaceAll('\n', '\r\n');
    expect(parseApplyPatch(crlf)).toEqual([{ type: 'add', path: 'a.txt', content: 'x\n' }]);
  });

  it('Add 区分空文件与空白行，非空内容固定生成 LF 终止换行', () => {
    expect(parseApplyPatch(envelope('*** Add File: empty.txt'))).toEqual([
      { type: 'add', path: 'empty.txt', content: '' },
    ]);
    expect(parseApplyPatch(envelope('*** Add File: blank.txt\n+'))).toEqual([
      { type: 'add', path: 'blank.txt', content: '\n' },
    ]);
    expect(parseApplyPatch(envelope('*** Add File: a.txt\n+x'))).toEqual([
      { type: 'add', path: 'a.txt', content: 'x\n' },
    ]);
  });

  it.each(['@@ ', '@@\t', '@@ \t'])('裸 @@ 的结构尾空白按空 marker 接受：%j', (marker) => {
    const [operation] = parseApplyPatch(envelope(`*** Update File: a.txt\n${marker}\n-old\n+new`));
    expect(operation).toMatchObject({
      type: 'update',
      chunks: [{ oldLines: ['old'], newLines: ['new'] }],
    });
    if (operation.type !== 'update') throw new Error('expected update');
    expect(operation.chunks[0]).not.toHaveProperty('changeContext');
  });

  it('非空 @@ anchor 的尾空白保持原样', () => {
    const [operation] = parseApplyPatch(
      envelope('*** Update File: a.txt\n@@ function name  \t\n-old\n+new')
    );
    if (operation.type !== 'update') throw new Error('expected update');
    expect(operation.chunks[0].changeContext).toBe('function name  \t');
  });

  it('允许仅 rename 的 Update，但 EOF 标记只能位于 chunk 末尾', () => {
    expect(parseApplyPatch(envelope('*** Update File: a.txt\n*** Move to: b.txt'))).toMatchObject([
      { type: 'update', path: 'a.txt', movePath: 'b.txt', chunks: [] },
    ]);
    expect(() =>
      parseApplyPatch(envelope('*** Update File: a.txt\n@@\n-old\n+new\n*** End of File\n+late'))
    ).toThrow();
  });

  it('跳过只有上下文的定位 hunk，保留真正的改动', () => {
    const [operation] = parseApplyPatch(
      envelope(
        [
          '*** Update File: a.txt',
          '@@',
          ' it("existing") {',
          '@@',
          '   expect(tail);',
          ' }',
          '+',
          '+it("new") {',
          '+}',
        ].join('\n')
      )
    );
    expect(operation).toMatchObject({
      type: 'update',
      path: 'a.txt',
      chunks: [
        {
          oldLines: ['  expect(tail);', '}'],
          newLines: ['  expect(tail);', '}', '', 'it("new") {', '}'],
        },
      ],
    });
  });

  it('前后都有定位 hunk 时只保留中间的实质改动', () => {
    const [operation] = parseApplyPatch(
      envelope(
        [
          '*** Update File: a.txt',
          '@@ leading',
          ' keep',
          '@@',
          '-old',
          '+new',
          '@@',
          ' trailing',
        ].join('\n')
      )
    );
    expect(operation).toMatchObject({
      type: 'update',
      chunks: [{ oldLines: ['old'], newLines: ['new'] }],
    });
  });

  it('只有定位 hunk 的 Update 仍拒绝；有 -/+ 但内容相同也拒绝', () => {
    expect(() => parseApplyPatch(envelope('*** Update File: a.txt\n@@\n same'))).toThrow(
      /Update file 'a.txt' has no '-'\/'\+' edits/
    );
    expect(() => parseApplyPatch(envelope('*** Update File: a.txt\n@@\n-same\n+same'))).toThrow(
      /No-op update chunk at line 3: '-' and '\+' lines are identical/
    );
    expect(() =>
      parseApplyPatch(envelope('*** Update File: a.txt\n@@\n-same\n+same\n@@\n-old\n+new'))
    ).toThrow(/No-op update chunk at line 3: '-' and '\+' lines are identical/);
  });
});
