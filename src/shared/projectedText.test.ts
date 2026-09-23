import { describe, expect, it } from 'vitest';
import { truncatedProjectionHead } from './projectedText';
import { PROJECTED_FILE_TEXT_LIMIT } from './types/fileChanges';

describe('truncatedProjectionHead', () => {
  it('返回被截断投影的前缀', () => {
    const head = 'x'.repeat(PROJECTED_FILE_TEXT_LIMIT);
    expect(truncatedProjectionHead(`${head}\n…`)).toBe(head);
  });

  it('未达上限或无截断标记时不视为截断', () => {
    expect(truncatedProjectionHead('短消息\n…')).toBeNull();
    expect(truncatedProjectionHead('x'.repeat(PROJECTED_FILE_TEXT_LIMIT + 2))).toBeNull();
  });
});
