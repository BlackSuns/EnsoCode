import { describe, expect, it } from 'vitest';
import { computeFileHash, formatHashlineHeader, formatNumberedLines } from './format';

describe('computeFileHash', () => {
  it('生成稳定的 4 位大写十六进制标签', () => {
    const first = computeFileHash('alpha\nbeta\n');
    expect(first).toMatch(/^[0-9A-F]{4}$/);
    expect(computeFileHash('alpha\nbeta\n')).toBe(first);
  });

  it('忽略每一行及末行尾部的空格、制表符和回车', () => {
    expect(computeFileHash('alpha \t\r\nbeta\t\r')).toBe(computeFileHash('alpha\nbeta'));
  });

  it('文件内容变化时生成不同标签', () => {
    expect(computeFileHash('alpha\nbeta')).not.toBe(computeFileHash('alpha\ngamma'));
  });
});

describe('formatHashlineHeader', () => {
  it('把文件路径与标签格式化为 Hashline 文件头', () => {
    expect(formatHashlineHeader('src/example.ts', '1A2B')).toBe('[src/example.ts#1A2B]');
  });
});

describe('formatNumberedLines', () => {
  it('末尾换行只终止最后一行，不显示不可寻址的幻影行', () => {
    expect(formatNumberedLines('a\n')).toBe('1:a');
    expect(formatNumberedLines('a\r\nb\r\n')).toBe('1:a\n2:b');
  });

  it('空文件仍显示唯一可寻址的空行', () => {
    expect(formatNumberedLines('')).toBe('1:');
  });

  it('保留末尾换行之前真实存在的连续空行', () => {
    expect(formatNumberedLines('a\n\n\n')).toBe('1:a\n2:\n3:');
  });

  it('局部读取从指定行编号且不为末尾换行额外编号', () => {
    expect(formatNumberedLines('c\nd\n', 3)).toBe('3:c\n4:d');
  });
});
