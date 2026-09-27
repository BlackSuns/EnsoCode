import { describe, expect, it } from 'vitest';
import { parseMemorySearchHits } from './memorySearchHits';

const hit = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  title: 'RTK 采用官方 prebuilt',
  content: '随应用分发，默认开启',
  unitType: 'decision',
  spaceId: 'proj:3e8d',
  score: 0.955,
  isLatest: true,
  ...over,
});

describe('parseMemorySearchHits', () => {
  it('把 Main bridge 投影的 JSON 解析为命中列表，并区分全局/项目空间', () => {
    const output = JSON.stringify({
      results: [hit(), hit({ id: 'm2', spaceId: 'global', unitType: 'preference', score: 1.2 })],
    });
    expect(parseMemorySearchHits(output)).toEqual([
      {
        id: 'm1',
        title: 'RTK 采用官方 prebuilt',
        content: '随应用分发，默认开启',
        unitType: 'decision',
        space: 'project',
        score: 0.955,
      },
      {
        id: 'm2',
        title: 'RTK 采用官方 prebuilt',
        content: '随应用分发，默认开启',
        unitType: 'preference',
        space: 'global',
        score: 1.2,
      },
    ]);
  });

  it('空结果是合法命中列表，而不是解析失败', () => {
    expect(parseMemorySearchHits('{"results":[]}')).toEqual([]);
  });

  it('可选字段缺失或非法时置空，不拖垮整条结果', () => {
    expect(
      parseMemorySearchHits(
        JSON.stringify({
          results: [hit({ unitType: undefined, spaceId: 'team:x', score: 'high' })],
        })
      )
    ).toEqual([
      {
        id: 'm1',
        title: 'RTK 采用官方 prebuilt',
        content: '随应用分发，默认开启',
        unitType: null,
        space: null,
        score: null,
      },
    ]);
  });

  it.each([
    ['null', null],
    ['空串', ''],
    ['错误文本', 'Memory is disabled'],
    ['超长输出外置回执', '[output externalized: 40000 chars → /tmp/x.txt]'],
    ['非对象', '[1,2]'],
    ['缺 results', '{"error":"no_project"}'],
    ['results 非数组', '{"results":"x"}'],
    ['条目缺 content', JSON.stringify({ results: [hit({ content: undefined })] })],
    ['条目 id 为空', JSON.stringify({ results: [hit({ id: '' })] })],
    ['条目非对象', '{"results":[null]}'],
  ])('形状不符（%s）返回 null，交给调用方回退原文', (_label, output) => {
    expect(parseMemorySearchHits(output)).toBeNull();
  });
});
