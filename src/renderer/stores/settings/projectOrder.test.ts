import { describe, expect, it } from 'vitest';
import {
  applyProjectOrder,
  moveProject,
  partitionPinnedProjects,
  projectReorderScope,
  togglePinnedProjectId,
} from './projectOrder';

interface P {
  id: string;
}
const projects: P[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('applyProjectOrder', () => {
  it('按已存顺序重排', () => {
    expect(applyProjectOrder(projects, ['c', 'a', 'b']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('savedIds 里没有的新项目按原序追加末尾', () => {
    expect(applyProjectOrder(projects, ['c']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('savedIds 中已不存在的项目 id 忽略', () => {
    expect(applyProjectOrder(projects, ['ghost', 'b', 'a']).map((p) => p.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('空 savedIds 时保持原序', () => {
    expect(applyProjectOrder(projects, []).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('不修改入参数组', () => {
    const input = [...projects];
    applyProjectOrder(input, ['c', 'a']);
    expect(input.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('moveProject', () => {
  it('把 activeId 移到 overId 的位置,返回完整 id 顺序', () => {
    expect(moveProject(projects, [], 'a', 'c')).toEqual(['b', 'c', 'a']);
  });

  it('基于已存顺序移动', () => {
    expect(moveProject(projects, ['c', 'a', 'b'], 'b', 'c')).toEqual(['b', 'c', 'a']);
  });

  it('activeId 与 overId 相同时返回当前顺序', () => {
    expect(moveProject(projects, [], 'a', 'a')).toEqual(['a', 'b', 'c']);
  });

  it('未知 id 不移动', () => {
    expect(moveProject(projects, [], 'ghost', 'b')).toEqual(['a', 'b', 'c']);
  });
});

describe('partitionPinnedProjects', () => {
  it('置顶项目按 pinnedIds 顺序排在前面，其余保持原相对顺序', () => {
    expect(partitionPinnedProjects(projects, ['c', 'a'])).toEqual({
      pinned: [{ id: 'c' }, { id: 'a' }],
      rest: [{ id: 'b' }],
    });
  });

  it('未知置顶 id 忽略', () => {
    expect(partitionPinnedProjects(projects, ['ghost', 'b']).pinned.map((p) => p.id)).toEqual([
      'b',
    ]);
  });

  it('空 pinnedIds 时全部落在 rest', () => {
    expect(partitionPinnedProjects(projects, [])).toEqual({
      pinned: [],
      rest: projects,
    });
  });

  it('不修改入参数组', () => {
    const input = [...projects];
    partitionPinnedProjects(input, ['c']);
    expect(input.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('togglePinnedProjectId', () => {
  it('未置顶则插到最前', () => {
    expect(togglePinnedProjectId(['b'], 'a')).toEqual(['a', 'b']);
  });

  it('已置顶则移除', () => {
    expect(togglePinnedProjectId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('projectReorderScope', () => {
  it('两边都置顶则重排置顶序', () => {
    expect(projectReorderScope('a', 'b', ['a', 'b'])).toBe('pinned');
  });

  it('两边都未置顶则重排项目序', () => {
    expect(projectReorderScope('a', 'b', [])).toBe('order');
  });

  it('跨越置顶边界不排', () => {
    expect(projectReorderScope('a', 'b', ['a'])).toBeNull();
  });
});
