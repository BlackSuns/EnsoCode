import { describe, expect, it } from 'vitest';
import { applyHashlineToText } from './apply';

describe('applyHashlineToText', () => {
  it('替换首行时保留后续行和文件末尾换行', () => {
    expect(applyHashlineToText('world\nlater\n', 'PUT 1.=1:\n+hello')).toBe('hello\nlater\n');
  });

  it('同一补丁的多个 PUT 均按原始快照行号定位', () => {
    const patch = 'PUT 1.=1:\n+A1\n+A2\nPUT 4.=4:\n+D2';
    expect(applyHashlineToText('A\nB\nC\nD\n', patch)).toBe('A1\nA2\nB\nC\nD2\n');
  });

  it('接受 CRLF 补丁并保留 CRLF 文件的原换行符', () => {
    expect(applyHashlineToText('old\r\nkeep\r\n', 'PUT 1.=1:\r\n+new\r\n')).toBe('new\r\nkeep\r\n');
  });

  it('替换首行时保留文件 BOM', () => {
    expect(applyHashlineToText('\uFEFFold\nkeep\n', 'PUT 1.=1:\n+new')).toBe('\uFEFFnew\nkeep\n');
  });

  it('替换非首行时仍保留文件 BOM 和首行内容', () => {
    expect(applyHashlineToText('\uFEFFkeep\nold\n', 'PUT 2.=2:\n+new')).toBe('\uFEFFkeep\nnew\n');
  });

  it('混合 EOL 文件只替换首行时保留未修改行的原分隔符', () => {
    expect(applyHashlineToText('a\nb\r\nc\n', 'PUT 1.=1:\n+A')).toBe('A\nb\r\nc\n');
  });

  it('替换区新增多行时使用目标行的 EOL', () => {
    expect(applyHashlineToText('a\nb\r\nc\n', 'PUT 2.=2:\n+B1\n+B2')).toBe('a\nB1\r\nB2\r\nc\n');
  });

  it('混合 EOL 文件保留原末尾 CRLF', () => {
    expect(applyHashlineToText('a\r\nb\nc\r\n', 'PUT 2.=2:\n+B')).toBe('a\r\nB\nc\r\n');
  });

  it('CRLF 文件替换中间行时不改变其他内容', () => {
    expect(applyHashlineToText('first\r\nold\r\nlast\r\n', 'PUT 2.=2:\n+new')).toBe(
      'first\r\nnew\r\nlast\r\n'
    );
  });

  it('无末尾换行的 LF 文件替换尾行后仍不添加末尾换行', () => {
    expect(applyHashlineToText('first\nold', 'PUT 2.=2:\n+new')).toBe('first\nnew');
  });

  it('无末尾换行的 CRLF 文件替换尾行后仍不添加末尾换行', () => {
    expect(applyHashlineToText('first\r\nold', 'PUT 2.=2:\n+new')).toBe('first\r\nnew');
  });

  it('末尾换行不是可寻址行', () => {
    expect(() => applyHashlineToText('one\n', 'PUT 2.=2:\n+new')).toThrow(/out of range/);
  });

  it('拒绝把前一段编辑后的行号当成后一段 PUT 的锚点', () => {
    const patch = 'PUT 1.=2:\n+merged\n+draft\nPUT 2.=2:\n+final';
    expect(() => applyHashlineToText('one\ntwo\nthree\n', patch)).toThrow();
  });

  it('拒绝没有替换正文的 PUT', () => {
    expect(() => applyHashlineToText('one\ntwo\n', 'PUT 1.=1:')).toThrow();
  });

  it('拒绝起始行大于结束行的 PUT', () => {
    expect(() => applyHashlineToText('one\ntwo\n', 'PUT 2.=1:\n+replacement')).toThrow();
  });

  it('拒绝替换后内容完全相同的无效补丁', () => {
    expect(() => applyHashlineToText('one\ntwo\n', 'PUT 1.=1:\n+one')).toThrow();
    expect(() => applyHashlineToText('a\nb\r\nc\n', 'PUT 2.=2:\n+b')).toThrow();
  });
});
