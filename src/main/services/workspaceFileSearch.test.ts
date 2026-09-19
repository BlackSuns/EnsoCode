import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildContentSearchArgs,
  buildNameSearchArgs,
  parseRipgrepJsonMatch,
  rankNameHits,
  searchWorkspaceFiles,
  toRelativePosix,
} from './workspaceFileSearch';

describe('toRelativePosix', () => {
  it('只接受 cwd 内路径并转 posix', () => {
    const root = path.join('/tmp', 'ws');
    expect(toRelativePosix(root, path.join(root, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(toRelativePosix(root, path.join(root, '..', 'escape.ts'))).toBeNull();
    expect(toRelativePosix(root, '/etc/passwd')).toBeNull();
  });
});

describe('rankNameHits', () => {
  it('按文件名模糊排序且不含绝对路径', () => {
    const hits = rankNameHits(['src/ChatView.tsx', 'src/chat.ts', 'README.md'], 'chat', 10);
    expect(hits[0]?.relativePath).toBe('src/chat.ts');
    expect(hits.map((hit) => hit.name)).toContain('ChatView.tsx');
    expect(JSON.stringify(hits)).not.toMatch(/[/\\]tmp|C:\\/i);
  });

  it('空查询不返回清单', () => {
    expect(rankNameHits(['a.ts'], '  ', 10)).toEqual([]);
  });
});

describe('parseRipgrepJsonMatch', () => {
  it('抽出相对路径与行列，丢掉绝对 path', () => {
    const root = path.join('/tmp', 'ws');
    const hit = parseRipgrepJsonMatch(
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: path.join(root, 'src', 'a.ts') },
          line_number: 3,
          lines: { text: 'hello world\n' },
          submatches: [{ start: 6, end: 11 }],
        },
      }),
      root
    );
    expect(hit).toEqual({
      relativePath: 'src/a.ts',
      line: 3,
      column: 6,
      matchLength: 5,
      content: 'hello world',
    });
  });

  it('cwd 外命中丢弃', () => {
    expect(
      parseRipgrepJsonMatch(
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: '/etc/passwd' },
            line_number: 1,
            lines: { text: 'root' },
            submatches: [{ start: 0, end: 4 }],
          },
        }),
        path.join('/tmp', 'ws')
      )
    ).toBeNull();
  });
});

describe('rg args', () => {
  it('文件名搜索只列文件', () => {
    expect(buildNameSearchArgs()).toEqual(
      expect.arrayContaining(['--files', '--glob', '!node_modules/**', '.'])
    );
  });

  it('内容搜索在 -- 之后才放查询', () => {
    expect(
      buildContentSearchArgs({
        query: '--help',
        caseSensitive: false,
        wholeWord: true,
        regex: false,
      })
    ).toEqual(expect.arrayContaining(['--json', '-i', '-w', '-F', '--', '--help', '.']));
  });
});

describe('searchWorkspaceFiles', () => {
  it('names 模式用列举结果做模糊命中', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: 'src/chat.ts\nsrc/ChatView.tsx\n',
    }));
    const result = await searchWorkspaceFiles(
      '/tmp/ws',
      {
        conversationId: 'c',
        projectId: 'p',
        query: 'chat',
        mode: 'names',
        maxResults: 10,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      },
      run
    );
    expect(run).toHaveBeenCalledWith(buildNameSearchArgs(), '/tmp/ws');
    expect(result).toEqual({
      ok: true,
      mode: 'names',
      hits: [
        { relativePath: 'src/chat.ts', name: 'chat.ts' },
        { relativePath: 'src/ChatView.tsx', name: 'ChatView.tsx' },
      ],
    });
  });

  it('content 空查询不跑 rg', async () => {
    const run = vi.fn();
    await expect(
      searchWorkspaceFiles(
        '/tmp/ws',
        {
          conversationId: 'c',
          projectId: 'p',
          query: '  ',
          mode: 'content',
          maxResults: 10,
          caseSensitive: false,
          wholeWord: false,
          regex: false,
        },
        run
      )
    ).resolves.toEqual({ ok: true, mode: 'content', hits: [], truncated: false });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('searchWorkspaceFiles 真机 rg', () => {
  it('能搜到文件名和内容', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-rg-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.writeFileSync(path.join(tmp, 'src', 'hello.ts'), 'uniqueTokenAlpha\n');
      const names = await searchWorkspaceFiles(tmp, {
        conversationId: 'c',
        projectId: 'p',
        query: 'hello',
        mode: 'names',
        maxResults: 10,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      });
      expect(names).toEqual({
        ok: true,
        mode: 'names',
        hits: [{ relativePath: 'src/hello.ts', name: 'hello.ts' }],
      });
      const content = await searchWorkspaceFiles(tmp, {
        conversationId: 'c',
        projectId: 'p',
        query: 'uniqueTokenAlpha',
        mode: 'content',
        maxResults: 10,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      });
      expect(content.ok).toBe(true);
      if (!content.ok || content.mode !== 'content') throw new Error('expected content hits');
      expect(content.hits[0]).toMatchObject({
        relativePath: 'src/hello.ts',
        line: 1,
        content: 'uniqueTokenAlpha',
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
