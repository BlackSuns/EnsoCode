import { describe, expect, it } from 'vitest';
import type { WorkflowDesign } from './types/workflow';
import { generateWorkflowScript, parseWorkflowDesign } from './workflowDesign';

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
