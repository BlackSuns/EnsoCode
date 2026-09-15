import { describe, expect, it } from 'vitest';
import { stripAnsi } from './terminalText';

describe('stripAnsi', () => {
  it('task_output 的 Vitest 日志去掉颜色和字重控制码，保留测试正文', () => {
    const output =
      '[done (exit 0)] Full log: /tmp/task.log\n' +
      '     \x1b[33m\x1b[2m✓\x1b[22m\x1b[39m rejects unsafe branch "HEAD" without mutation \x1b[33m 3548\x1b[2mms\x1b[22m\x1b[39m\n';
    expect(stripAnsi(output)).toBe(
      '[done (exit 0)] Full log: /tmp/task.log\n' +
        '     ✓ rejects unsafe branch "HEAD" without mutation  3548ms\n'
    );
  });

  it.each([
    ['\x1b[38;2;120;80;40m彩色\x1b[0m', '彩色'],
    ['\x1b[38:2::120:80:40m彩色\x1b[0m', '彩色'],
    ['\x1b[?25l\x1b[2K进度\x1b[1G\x1b[?25h', '进度'],
    ['\x9b32m通过\x9b0m', '通过'],
    ['\x1b]8;;https://example.com\x07报告\x1b]8;;\x07', '报告'],
    ['\x1b]8;;https://example.com\x1b\\报告\x1b]8;;\x1b\\', '报告'],
    ['\x9d8;;https://example.com\x9c报告\x9d8;;\x9c', '报告'],
    ['\x1b]0;terminal title\x07正文', '正文'],
  ])('移除终端控制序列但保留可见内容：%j', (input, expected) => {
    expect(stripAnsi(input)).toBe(expected);
  });

  it.each(['\x1b[', '\x1b[38;2;', '\x1b]0;unfinished title'])(
    '流式快照末尾的不完整控制序列不泄露：%j',
    (suffix) => {
      expect(stripAnsi(`输出${suffix}`)).toBe('输出');
    }
  );

  it('普通文本、缩进、换行、Unicode 和字面的转义写法保持原样', () => {
    const text = '  ✓ 中文\t🙂\r\n[33m literal \\x1b[32m \\u001b[0m\n';
    expect(stripAnsi(text)).toBe(text);
    expect(stripAnsi('')).toBe('');
  });
});
