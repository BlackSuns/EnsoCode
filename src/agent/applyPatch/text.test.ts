import { describe, expect, it } from 'vitest';
import { applyUpdateChunks } from './text';

function update(raw: string, chunks: Parameters<typeof applyUpdateChunks>[2]): string {
  return applyUpdateChunks(Buffer.from(raw, 'utf8'), 'file.txt', chunks).toString('utf8');
}

describe('apply_patch 匹配与落盘重建', () => {
  it('按 exact → trimEnd → trim → Unicode 标点 四档 first-match', () => {
    expect(
      update('foo\nbar\nbaz\n', [
        {
          oldLines: ['bar', 'baz'],
          newLines: ['BAR', 'BAZ'],
          contextLineIndices: [],
          endOfFile: false,
        },
      ])
    ).toBe('foo\nBAR\nBAZ\n');
    expect(
      update('foo   \nbar\t\t\n', [
        {
          oldLines: ['foo', 'bar'],
          newLines: ['FOO', 'BAR'],
          contextLineIndices: [],
          endOfFile: false,
        },
      ])
    ).toBe('FOO\nBAR\n');
    expect(
      update('    foo   \n   bar\t\n', [
        {
          oldLines: ['foo', 'bar'],
          newLines: ['FOO', 'BAR'],
          contextLineIndices: [],
          endOfFile: false,
        },
      ])
    ).toBe('FOO\nBAR\n');
    expect(
      update('say “hello”\n', [
        {
          oldLines: ['say "hello"'],
          newLines: ['say hi'],
          contextLineIndices: [],
          endOfFile: false,
        },
      ])
    ).toBe('say hi\n');
  });

  it('重复行取第一个匹配，不因歧义拒绝', () => {
    expect(
      update('same\nsame\ntail\n', [
        { oldLines: ['same'], newLines: ['changed'], contextLineIndices: [], endOfFile: false },
      ])
    ).toBe('changed\nsame\ntail\n');
  });

  it('空 old_lines 追加到文件末尾并补上文件惯用换行', () => {
    expect(
      update('head\n', [
        { oldLines: [], newLines: ['tail'], contextLineIndices: [], endOfFile: false },
      ])
    ).toBe('head\ntail\n');
    expect(
      update('', [{ oldLines: [], newLines: ['only'], contextLineIndices: [], endOfFile: false }])
    ).toBe('only\n');
  });

  it('更新后为无终止换行的最后一行补上惯用 ending', () => {
    expect(
      update('head\nold', [
        { oldLines: ['old'], newLines: ['new'], contextLineIndices: [], endOfFile: true },
      ])
    ).toBe('head\nnew\n');
  });

  it('未改行保留原 EOL，新行用首选 ending，并保留 BOM', () => {
    expect(
      applyUpdateChunks(Buffer.from('\uFEFFkeep  \r\nold\nlast', 'utf8'), 'mixed.txt', [
        {
          oldLines: ['keep  ', 'old', 'last'],
          newLines: ['keep  ', 'new', 'last'],
          contextLineIndices: [
            [0, 0],
            [2, 2],
          ],
          endOfFile: false,
        },
      ])
    ).toEqual(Buffer.from('\uFEFFkeep  \r\nnew\r\nlast\r\n', 'utf8'));
  });
});
