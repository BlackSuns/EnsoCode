import type { SubagentActivity } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import {
  finishToolActivity,
  MAX_SUBAGENT_ACTIVITIES,
  MAX_SUBAGENT_ACTIVITY_TEXT,
  MAX_SUBAGENT_ACTIVITY_TOTAL_TEXT,
  settleSubagentActivities,
  startToolActivity,
  updateAssistantActivity,
  updateToolActivity,
} from './subagentActivity';

describe('subagent activity projection', () => {
  it('流式 assistant 文本按同一 id 覆盖，且忽略 thinking', () => {
    const started = updateAssistantActivity([], 'assistant-1', {
      content: [
        { type: 'thinking', thinking: 'secret reasoning' },
        { type: 'text', text: 'hello' },
      ],
    });
    const updated = updateAssistantActivity(
      started,
      'assistant-1',
      { content: [{ type: 'text', text: 'hello world' }] },
      false
    );

    expect(updated).toEqual([
      { id: 'assistant-1', type: 'assistant', text: 'hello world', streaming: false },
    ]);
    expect(JSON.stringify(updated)).not.toContain('secret reasoning');
  });

  it('记录有界工具参数、流式输出和最终结果，并脱敏秘密字段', () => {
    const started = startToolActivity([], 'tool-1', 'bash', {
      command: 'printf ok',
      apiKey: 'main-only-secret',
      OPENAI_API_KEY: 'prefixed-secret',
      'x-api-key': 'header-secret',
    });
    const streaming = updateToolActivity(started, 'tool-1', {
      content: [{ type: 'text', text: 'o' }],
    });
    const finished = finishToolActivity(streaming, 'tool-1', {
      content: [{ type: 'text', text: 'ok' }],
    });

    expect(finished).toEqual([
      {
        id: 'tool-1',
        type: 'tool',
        toolName: 'bash',
        argumentsText: expect.stringContaining('printf ok'),
        outputText: 'ok',
        status: 'done',
      },
    ]);
    expect(JSON.stringify(finished)).not.toContain('main-only-secret');
    expect(JSON.stringify(finished)).not.toContain('prefixed-secret');
    expect(JSON.stringify(finished)).not.toContain('header-secret');
  });

  it('工具长输出保留开头和错误尾部，并明确标记截断', () => {
    const started = startToolActivity([], 'tool-1', 'test', {});
    const output = `BEGIN\n${'x'.repeat(MAX_SUBAGENT_ACTIVITY_TEXT)}\nFATAL: failed at end`;
    const finished = finishToolActivity(started, 'tool-1', {
      content: [{ type: 'text', text: output }],
    });
    const activity = finished[0];
    expect(activity?.type).toBe('tool');
    if (activity?.type !== 'tool') throw new Error('expected tool activity');
    expect(activity.outputText).toContain('BEGIN');
    expect(activity.outputText).toContain('FATAL: failed at end');
    expect(activity.outputText).toContain('truncated');
    expect(activity.outputText?.length).toBeLessThanOrEqual(MAX_SUBAGENT_ACTIVITY_TEXT);
  });

  it('图片工具结果只保留占位，不传图片数据', () => {
    const started = startToolActivity([], 'tool-1', 'screenshot', {});
    const finished = finishToolActivity(started, 'tool-1', {
      content: [{ type: 'image', data: 'base64-secret-image', mimeType: 'image/png' }],
    });
    expect(finished[0]).toMatchObject({ outputText: '[image omitted]' });
    expect(JSON.stringify(finished)).not.toContain('base64-secret-image');
  });

  it('终态统一结束流式正文和仍在运行的工具', () => {
    const activities: SubagentActivity[] = [
      { id: 'a', type: 'assistant', text: 'partial', streaming: true },
      {
        id: 't',
        type: 'tool',
        toolName: 'bash',
        argumentsText: '{}',
        status: 'running',
      },
    ];
    expect(settleSubagentActivities(activities, 'aborted')).toEqual([
      { id: 'a', type: 'assistant', text: 'partial', streaming: false },
      {
        id: 't',
        type: 'tool',
        toolName: 'bash',
        argumentsText: '{}',
        status: 'aborted',
      },
    ]);
  });

  it('限制单条长度和总条数，更新旧条目不扩容', () => {
    let activities: SubagentActivity[] = [];
    for (let i = 0; i < MAX_SUBAGENT_ACTIVITIES + 5; i += 1) {
      activities = updateAssistantActivity(activities, `a-${i}`, {
        content: [{ type: 'text', text: String(i) }],
      });
    }
    expect(activities).toHaveLength(MAX_SUBAGENT_ACTIVITIES);
    expect(activities[0]?.id).toBe('a-5');

    const updated = updateAssistantActivity(activities, `a-${MAX_SUBAGENT_ACTIVITIES + 4}`, {
      content: [{ type: 'text', text: 'x'.repeat(MAX_SUBAGENT_ACTIVITY_TEXT + 20) }],
    });
    expect(updated).toHaveLength(MAX_SUBAGENT_ACTIVITIES);
    const last = updated.at(-1);
    expect(last?.type).toBe('assistant');
    expect(last?.type === 'assistant' ? last.text.length : undefined).toBeLessThanOrEqual(
      MAX_SUBAGENT_ACTIVITY_TEXT
    );
  });

  it('限制活动投影的总文本预算', () => {
    expect(MAX_SUBAGENT_ACTIVITY_TEXT).toBeLessThanOrEqual(MAX_SUBAGENT_ACTIVITY_TOTAL_TEXT);
    let activities: SubagentActivity[] = [];
    for (let i = 0; i < MAX_SUBAGENT_ACTIVITIES; i += 1) {
      activities = updateAssistantActivity(activities, `long-${i}`, {
        content: [{ type: 'text', text: 'x'.repeat(MAX_SUBAGENT_ACTIVITY_TEXT) }],
      });
    }
    const size = activities.reduce(
      (total, activity) =>
        total +
        (activity.type === 'assistant'
          ? activity.text.length
          : activity.argumentsText.length + (activity.outputText?.length ?? 0)),
      0
    );
    expect(size).toBeLessThanOrEqual(MAX_SUBAGENT_ACTIVITY_TOTAL_TEXT);
    expect(activities.at(-1)?.id).toBe(`long-${MAX_SUBAGENT_ACTIVITIES - 1}`);
  });

  it('坏输入、循环参数和无主结果不抛错', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => startToolActivity([], 'tool-1', 'custom', circular)).not.toThrow();
    expect(updateAssistantActivity([], 'a', { content: [{ type: 'text', text: 1 }] })).toEqual([]);
    expect(updateToolActivity([], 'missing', { content: 'x' })).toEqual([]);
    expect(finishToolActivity([], 'missing', null, true)).toEqual([]);
  });
});
