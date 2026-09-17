import { describe, expect, it } from 'vitest';
import {
  getApplyPatchPaths,
  looksLikeApplyPatchDocument,
  normalizeApplyPatchArguments,
  parseApplyPatch,
} from './index';

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

  it('信封首尾空白可 trim，错误文案与 Codex 一致', () => {
    expect(parseApplyPatch(`  \n${envelope('*** Add File: a.txt\n+hi')}  \n`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(() => parseApplyPatch('bad')).toThrow(
      "invalid patch: The first line of the patch must be '*** Begin Patch'"
    );
    expect(() => parseApplyPatch('*** Begin Patch\nbad')).toThrow(
      "invalid patch: The last line of the patch must be '*** End Patch'"
    );
  });

  it('空 envelope 解析为空操作；空 Update 与 rename-only 拒绝', () => {
    expect(parseApplyPatch('*** Begin Patch\n*** End Patch')).toEqual([]);
    expect(() => parseApplyPatch(envelope('*** Update File: a.txt'))).toThrow(
      /Update file hunk for path 'a.txt' is empty/
    );
    expect(() => parseApplyPatch(envelope('*** Update File: a.txt\n*** Move to: b.txt'))).toThrow(
      /Update file hunk for path 'a.txt' is empty/
    );
    expect(() => parseApplyPatch(envelope('*** Update File: a.txt\n@@'))).toThrow(
      /Update hunk does not contain any lines/
    );
  });

  it.each([
    ['', 'envelope'],
    [envelope('*** Delete File: a.txt\n+bad'), 'syntax'],
    [envelope('*** Add File: a.txt\nvalue'), 'syntax'],
    [`prefix\n${envelope('*** Add File: a.txt\n+a')}`, 'envelope'],
  ])('拒绝非法 patch：%s', (patch) => {
    expect(() => parseApplyPatch(patch)).toThrow();
  });

  it('剥掉顶层 Begin/End 行尾多余 ***，正文里的装饰标记不改写', () => {
    const body = '*** Add File: a.txt\n+hi';
    expect(parseApplyPatch(`*** Begin Patch ***\n${body}\n*** End Patch ***`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(parseApplyPatch(`*** Begin Patch ***\n${body}\n*** End Patch`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(parseApplyPatch(`*** Begin Patch\n${body}\n*** End Patch ***`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(
      parseApplyPatch(
        `*** Begin Patch ***\r\n${body.replaceAll('\n', '\r\n')}\r\n*** End Patch ***\r\n`
      )
    ).toEqual([{ type: 'add', path: 'a.txt', content: 'hi\n' }]);
    const innerDecorated = envelope(
      [
        '*** Update File: docs.md',
        '@@',
        '-old',
        '+starts with *** Begin Patch ***',
        '+ends with *** End Patch ***',
      ].join('\n')
    );
    const [operation] = parseApplyPatch(innerDecorated);
    expect(operation).toMatchObject({
      type: 'update',
      chunks: [
        {
          oldLines: ['old'],
          newLines: ['starts with *** Begin Patch ***', 'ends with *** End Patch ***'],
        },
      ],
    });
    expect(() =>
      parseApplyPatch(`prefix\n*** Begin Patch ***\n${body}\n*** End Patch ***`)
    ).toThrow(/Begin Patch/);
    expect(() => parseApplyPatch('*** Begin Patch ***\nplain text\n*** End Patch ***')).toThrow(
      /Begin Patch/
    );
  });

  it('识别完整 apply_patch 信封，放过 JS 和残缺信封', () => {
    const body = '*** Add File: a.txt\n+hi';
    expect(looksLikeApplyPatchDocument(`*** Begin Patch\n${body}\n*** End Patch`)).toBe(true);
    expect(looksLikeApplyPatchDocument(`*** Begin Patch ***\n${body}\n*** End Patch ***`)).toBe(
      true
    );
    expect(looksLikeApplyPatchDocument(`\n*** Begin Patch\n${body}\n*** End Patch\n`)).toBe(true);
    expect(looksLikeApplyPatchDocument('*** Begin Patch\n*** End Patch')).toBe(false);
    expect(looksLikeApplyPatchDocument('*** Begin Patch ***\nplain text\n*** End Patch ***')).toBe(
      false
    );
    expect(
      looksLikeApplyPatchDocument(
        'const input = `*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch`;'
      )
    ).toBe(false);
    expect(looksLikeApplyPatchDocument('await apply_patch({ input: "x" })')).toBe(false);
  });

  it('接受 heredoc 包装，拒绝引号不匹配的 heredoc', () => {
    const inner = envelope('*** Add File: a.txt\n+hi');
    expect(parseApplyPatch(`<<EOF\n${inner}\nEOF\n`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(parseApplyPatch(`<<'EOF'\n${inner}\nEOF`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(parseApplyPatch(`<<"EOF"\n${inner}\nEOF`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'hi\n' },
    ]);
    expect(() => parseApplyPatch(`<<"EOF'\n${inner}\nEOF`)).toThrow(/Begin Patch/);
  });

  it('接受 Environment ID 且拒绝空或重复', () => {
    expect(
      parseApplyPatch(
        '*** Begin Patch\n*** Environment ID: remote\n*** Add File: a.txt\n+hi\n*** End Patch'
      )
    ).toEqual([{ type: 'add', path: 'a.txt', content: 'hi\n' }]);
    expect(() =>
      parseApplyPatch(
        '*** Begin Patch\n*** Environment ID:   \n*** Add File: a.txt\n+hi\n*** End Patch'
      )
    ).toThrow(/environment_id cannot be empty/);
    expect(() =>
      parseApplyPatch(
        '*** Begin Patch\n*** Environment ID: a\n*** Environment ID: b\n*** Add File: a.txt\n+hi\n*** End Patch'
      )
    ).toThrow(/more than once/);
  });

  it('CRLF 与 End Patch 后的空白行可解析；EOF 后不得再跟改动行', () => {
    const crlf = envelope('*** Add File: a.txt\n+x').replaceAll('\n', '\r\n');
    expect(parseApplyPatch(crlf)).toEqual([{ type: 'add', path: 'a.txt', content: 'x\n' }]);
    expect(parseApplyPatch(`${envelope('*** Add File: a.txt\n+x')}\n \t\n`)).toEqual([
      { type: 'add', path: 'a.txt', content: 'x\n' },
    ]);
    expect(() =>
      parseApplyPatch(envelope('*** Update File: a.txt\n@@\n-old\n+new\n*** End of File\n+late'))
    ).toThrow(/@@ context marker/);
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

  it('非空 @@ anchor 按 Codex trim_end，尾空白不保留', () => {
    const [operation] = parseApplyPatch(
      envelope('*** Update File: a.txt\n@@ function name  \t\n-old\n+new')
    );
    if (operation.type !== 'update') throw new Error('expected update');
    expect(operation.chunks[0].changeContext).toBe('function name');
  });

  it('Update 中无前缀空行当作空 context，不跳过 identity chunk', () => {
    const [operation] = parseApplyPatch(
      envelope(
        ['*** Update File: file.txt', '@@', ' context before', '', ' context after'].join('\n')
      )
    );
    expect(operation).toMatchObject({
      type: 'update',
      chunks: [
        {
          oldLines: ['context before', '', 'context after'],
          newLines: ['context before', '', 'context after'],
          contextLineIndices: [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        },
      ],
    });
    expect(parseApplyPatch(envelope('*** Update File: a.txt\n@@\n-same\n+same'))).toMatchObject([
      { type: 'update', chunks: [{ oldLines: ['same'], newLines: ['same'] }] },
    ]);
  });

  it('保留只有上下文的定位 hunk，不把后续改动合并掉', () => {
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
      chunks: [
        { changeContext: 'leading', oldLines: ['keep'], newLines: ['keep'] },
        { oldLines: ['old'], newLines: ['new'] },
        { oldLines: ['trailing'], newLines: ['trailing'] },
      ],
    });
  });
});
