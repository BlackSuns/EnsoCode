import type { WorkflowDesign } from '@shared/types/workflow';
import { describe, expect, it } from 'vitest';
import {
  addStep,
  canAddStep,
  clampSelection,
  insertPhase,
  movePhase,
  removeSelected,
} from './workflowDesignOps';

const step = (label: string) => ({ label, agentType: 'scout', prompt: 'p' });
const design = (): WorkflowDesign => ({
  phases: [
    { title: 'A', steps: [step('a1'), step('a2')] },
    { title: 'B', steps: [step('b1')] },
  ],
});
const shape = (d: WorkflowDesign) =>
  d.phases.map((p) => `${p.title}:${p.steps.map((s) => s.label)}`);

describe('workflowDesignOps', () => {
  it('添加并行步骤后选中新步骤', () => {
    const next = addStep(design(), 1, step('b2'));
    expect(shape(next.design)).toEqual(['A:a1,a2', 'B:b1,b2']);
    expect(next.selection).toEqual({ kind: 'step', phase: 1, step: 1 });
  });

  it('在任意位置插入阶段并选中该阶段', () => {
    const next = insertPhase(design(), 1, { title: 'M', steps: [step('m1')] });
    expect(shape(next.design)).toEqual(['A:a1,a2', 'M:m1', 'B:b1']);
    expect(next.selection).toEqual({ kind: 'phase', phase: 1 });
    expect(shape(insertPhase(design(), 9, { title: 'Z', steps: [step('z')] }).design).at(-1)).toBe(
      'Z:z'
    );
  });

  it('删除步骤选中相邻步骤；删掉阶段最后一个步骤时整个阶段移除', () => {
    const a = removeSelected(design(), { kind: 'step', phase: 0, step: 1 });
    expect(shape(a!.design)).toEqual(['A:a1', 'B:b1']);
    expect(a!.selection).toEqual({ kind: 'step', phase: 0, step: 0 });
    const b = removeSelected(design(), { kind: 'step', phase: 1, step: 0 });
    expect(shape(b!.design)).toEqual(['A:a1,a2']);
    expect(b!.selection).toEqual({ kind: 'phase', phase: 0 });
  });

  it('删除阶段选中相邻阶段；只剩一个阶段/一个步骤时不可删', () => {
    const next = removeSelected(design(), { kind: 'phase', phase: 0 });
    expect(shape(next!.design)).toEqual(['B:b1']);
    expect(next!.selection).toEqual({ kind: 'phase', phase: 0 });
    const single: WorkflowDesign = { phases: [{ title: 'A', steps: [step('a1')] }] };
    expect(removeSelected(single, { kind: 'phase', phase: 0 })).toBeNull();
    expect(removeSelected(single, { kind: 'step', phase: 0, step: 0 })).toBeNull();
  });

  it('移动阶段时选中跟着走，越界不动', () => {
    const next = movePhase(design(), 0, 1);
    expect(shape(next.design)).toEqual(['B:b1', 'A:a1,a2']);
    expect(next.selection).toEqual({ kind: 'phase', phase: 1 });
    expect(shape(movePhase(design(), 0, -1).design)).toEqual(shape(design()));
  });

  it('选中项越界时夹回有效节点', () => {
    expect(clampSelection(design(), { kind: 'step', phase: 5, step: 5 })).toEqual({
      kind: 'step',
      phase: 1,
      step: 0,
    });
    expect(clampSelection(design(), { kind: 'phase', phase: 7 })).toEqual({
      kind: 'phase',
      phase: 1,
    });
  });

  it('步骤总数不超过运行时上限', () => {
    const full: WorkflowDesign = {
      phases: [{ title: 'A', steps: Array.from({ length: 32 }, (_, i) => step(`s${i}`)) }],
    };
    expect(canAddStep(design())).toBe(true);
    expect(canAddStep(full)).toBe(false);
  });
});
