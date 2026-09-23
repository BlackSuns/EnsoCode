import { describe, expect, it } from 'vitest';
import type { WorkflowDesign } from './types/workflow';
import {
  generateWorkflowScript,
  insertPlaceholder,
  parseWorkflowDesign,
  placeholderTokens,
  splitPromptPlaceholders,
} from './workflowDesign';

const design = (): WorkflowDesign => ({
  phases: [
    {
      title: 'Investigate',
      steps: [
        { label: 'code', agentType: 'scout', prompt: 'Look at {{args.topic}} in code' },
        { label: 'tests', agentType: '', prompt: 'Tests for {{ args.topic }}' },
      ],
    },
    {
      title: 'Summarize',
      steps: [{ label: 'report', agentType: 'worker', prompt: 'Merge:\n{{prev}}' }],
    },
  ],
});

describe('parseWorkflowDesign', () => {
  it('收窄并修剪合法设计，丢弃多余字段', () => {
    const raw = design();
    (raw.phases[0] as unknown as Record<string, unknown>).extra = 1;
    raw.phases[0]!.title = '  Investigate  ';
    expect(parseWorkflowDesign(raw)).toEqual(design());
  });

  it('空阶段、空步骤、缺标签/提示词、坏 agentType、超上限都拒绝', () => {
    expect(parseWorkflowDesign(null)).toBeNull();
    expect(parseWorkflowDesign({ phases: [] })).toBeNull();
    expect(parseWorkflowDesign({ phases: [{ title: 'a', steps: [] }] })).toBeNull();
    const bad = (step: Record<string, unknown>) =>
      parseWorkflowDesign({ phases: [{ title: 'a', steps: [{ ...step }] }] });
    expect(bad({ label: 'x', agentType: '', prompt: ' ' })).toBeNull();
    expect(bad({ label: ' ', agentType: '', prompt: 'p' })).toBeNull();
    expect(bad({ label: 'x', agentType: 'bad type!', prompt: 'p' })).toBeNull();
    expect(bad({ label: 'x', agentType: 'scout', prompt: 'p' })).not.toBeNull();
    const step = { label: 'x', agentType: '', prompt: 'p' };
    const tooMany = { phases: [{ title: 'a', steps: Array.from({ length: 33 }, () => step) }] };
    expect(parseWorkflowDesign(tooMany)).toBeNull();
  });
});

describe('generateWorkflowScript', () => {
  it('生成的脚本对同一设计稳定，提示词里的引号/反斜杠/模板语法不会逃出字符串', () => {
    const tricky = design();
    tricky.phases[0]!.steps[0]!.prompt = 'a "b" \\ `c` $' + "{d} ' {{args.topic}}";
    const script = generateWorkflowScript(tricky);
    expect(generateWorkflowScript(tricky)).toBe(script);
    expect(
      () => new Function('args', 'agent', 'parallel', 'phase', `return (async () => {${script}})`)
    ).not.toThrow();
  });
});

describe('placeholderTokens', () => {
  it('只列合法参数；首个阶段没有上一阶段输出', () => {
    expect(placeholderTokens(['topic', '', 'bad key', 'scope'], 0)).toEqual([
      { kind: 'arg', key: 'topic', token: '{{args.topic}}' },
      { kind: 'arg', key: 'scope', token: '{{args.scope}}' },
    ]);
    expect(placeholderTokens([], 1)).toEqual([{ kind: 'prev', token: '{{prev}}' }]);
  });
});

describe('insertPlaceholder', () => {
  it('插入到光标处、替换选区，并返回插入后的光标位置', () => {
    expect(insertPlaceholder('Look at  now', 8, 8, '{{args.topic}}')).toEqual({
      text: 'Look at {{args.topic}} now',
      cursor: 22,
    });
    expect(insertPlaceholder('Look at X now', 8, 9, '{{prev}}')).toEqual({
      text: 'Look at {{prev}} now',
      cursor: 16,
    });
  });

  it('越界或反向的选区被夹紧，不丢原文', () => {
    expect(insertPlaceholder('abc', 99, 99, '{{prev}}')).toEqual({
      text: 'abc{{prev}}',
      cursor: 11,
    });
    expect(insertPlaceholder('abc', 2, 1, 'X').text).toBe('abXc');
  });
});

describe('splitPromptPlaceholders', () => {
  it('按占位符切成文本/参数/上一阶段片段，与脚本生成的识别口径一致', () => {
    expect(splitPromptPlaceholders('Look {{ args.topic }} and {{prev}}!{{args.bad key}}')).toEqual([
      { kind: 'text', text: 'Look ' },
      { kind: 'arg', key: 'topic' },
      { kind: 'text', text: ' and ' },
      { kind: 'prev' },
      { kind: 'text', text: '!{{args.bad key}}' },
    ]);
    expect(splitPromptPlaceholders('')).toEqual([]);
  });
});
