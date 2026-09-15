import type { SubagentActivity } from '@shared/types/agent';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AgentActivityView } from './TaskBar';

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('./Markdown', () => ({ Markdown: ({ text }: { text: string }) => text }));

const renderActivity = (activity: SubagentActivity): string =>
  renderToStaticMarkup(createElement(AgentActivityView, { activity }));

describe('AgentActivityView', () => {
  it('工具默认折叠，只在紧凑行显示名称、路径摘要和可访问状态', () => {
    const html = renderActivity({
      id: 'read-1',
      type: 'tool',
      toolName: 'read',
      argumentsText: '{\n  "path": "src/renderer/App.tsx",\n  "offset": 10\n}',
      outputText: 'FULL_RESULT_ONLY_WHEN_EXPANDED',
      status: 'done',
    });

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="subagent-tool-read-1"');
    expect(html).toContain('aria-label="done"');
    expect(html).toContain('>read<');
    expect(html).toContain('src/renderer/App.tsx');
    expect(html).not.toContain('&quot;path&quot;');
    expect(html).not.toContain('FULL_RESULT_ONLY_WHEN_EXPANDED');
    expect(html).not.toContain('Arguments');
    expect(html).not.toContain('Result');
  });

  it('运行中的搜索工具显示 pattern 摘要和状态语义', () => {
    const html = renderActivity({
      id: 'grep-1',
      type: 'tool',
      toolName: 'grep',
      argumentsText: '{"path":"src","pattern":"AgentActivityView"}',
      status: 'running',
    });

    expect(html).toContain('AgentActivityView');
    expect(html).toContain('aria-label="running"');
    expect(html).toContain('title="AgentActivityView"');
  });
});
