import { describe, expect, it } from 'vitest';
import { parseWorkspaceFileSearchRequest } from './workspaceFileSearch';

describe('parseWorkspaceFileSearchRequest', () => {
  it('收窄合法请求并忽略渲染层塞的路径', () => {
    expect(
      parseWorkspaceFileSearchRequest({
        conversationId: 'c',
        projectId: 'p',
        query: 'foo',
        mode: 'names',
        cwd: '/etc',
        rootPath: '/tmp',
      })
    ).toEqual({
      conversationId: 'c',
      projectId: 'p',
      query: 'foo',
      mode: 'names',
      maxResults: 80,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });
  });

  it('内容搜索默认上限与开关', () => {
    expect(
      parseWorkspaceFileSearchRequest({
        conversationId: 'c',
        projectId: 'p',
        query: 'bar',
        mode: 'content',
        maxResults: 12,
        caseSensitive: true,
        wholeWord: true,
        regex: true,
      })
    ).toEqual({
      conversationId: 'c',
      projectId: 'p',
      query: 'bar',
      mode: 'content',
      maxResults: 12,
      caseSensitive: true,
      wholeWord: true,
      regex: true,
    });
  });

  it('脏输入返回 null', () => {
    expect(parseWorkspaceFileSearchRequest(null)).toBeNull();
    expect(
      parseWorkspaceFileSearchRequest({ query: 'x', projectId: 'p', mode: 'names' })
    ).toBeNull();
    expect(
      parseWorkspaceFileSearchRequest({
        conversationId: '',
        projectId: 'p',
        query: 'x',
        mode: 'names',
      })
    ).toBeNull();
    expect(
      parseWorkspaceFileSearchRequest({
        conversationId: 'c',
        projectId: 'p',
        query: 1,
        mode: 'names',
      })
    ).toBeNull();
    expect(
      parseWorkspaceFileSearchRequest({
        conversationId: 'c',
        projectId: 'p',
        query: 'x',
        mode: 'everything',
      })
    ).toBeNull();
  });

  it('maxResults 超出范围则钳制', () => {
    const parsed = parseWorkspaceFileSearchRequest({
      conversationId: 'c',
      projectId: 'p',
      query: 'x',
      mode: 'content',
      maxResults: 9999,
    });
    expect(parsed?.maxResults).toBe(500);
    expect(
      parseWorkspaceFileSearchRequest({
        conversationId: 'c',
        projectId: 'p',
        query: 'x',
        mode: 'names',
        maxResults: 0,
      })?.maxResults
    ).toBe(1);
  });
});
