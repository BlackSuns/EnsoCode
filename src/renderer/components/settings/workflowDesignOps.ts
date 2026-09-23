import type {
  WorkflowDesign,
  WorkflowDesignPhase,
  WorkflowDesignStep,
} from '@shared/types/workflow';

/** 与运行时 agent 上限一致 */
const MAX_STEPS = 32;

export type DesignSelection =
  | { kind: 'phase'; phase: number }
  | { kind: 'step'; phase: number; step: number };

type Edit = { design: WorkflowDesign; selection: DesignSelection };

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

export function canAddStep(design: WorkflowDesign): boolean {
  return design.phases.reduce((sum, phase) => sum + phase.steps.length, 0) < MAX_STEPS;
}

export function addStep(design: WorkflowDesign, phase: number, step: WorkflowDesignStep): Edit {
  const phases = design.phases.map((item, i) =>
    i === phase ? { ...item, steps: [...item.steps, step] } : item
  );
  return {
    design: { phases },
    selection: { kind: 'step', phase, step: (phases[phase]?.steps.length ?? 1) - 1 },
  };
}

export function insertPhase(design: WorkflowDesign, at: number, phase: WorkflowDesignPhase): Edit {
  const index = clamp(at, design.phases.length);
  const phases = [...design.phases];
  phases.splice(index, 0, phase);
  return { design: { phases }, selection: { kind: 'phase', phase: index } };
}

/** 删掉阶段里最后一个步骤等于删阶段；整个设计至少保留一个阶段一个步骤 */
export function removeSelected(design: WorkflowDesign, selection: DesignSelection): Edit | null {
  const phase = design.phases[selection.phase];
  if (!phase) return null;
  if (selection.kind === 'step' && phase.steps.length > 1) {
    const steps = phase.steps.filter((_, i) => i !== selection.step);
    return {
      design: {
        phases: design.phases.map((item, i) => (i === selection.phase ? { ...item, steps } : item)),
      },
      selection: {
        kind: 'step',
        phase: selection.phase,
        step: clamp(selection.step, steps.length - 1),
      },
    };
  }
  if (design.phases.length === 1) return null;
  const phases = design.phases.filter((_, i) => i !== selection.phase);
  return {
    design: { phases },
    selection: { kind: 'phase', phase: clamp(selection.phase, phases.length - 1) },
  };
}

export function movePhase(design: WorkflowDesign, phase: number, delta: number): Edit {
  const target = phase + delta;
  if (target < 0 || target >= design.phases.length || !design.phases[phase]) {
    return { design, selection: { kind: 'phase', phase } };
  }
  const phases = [...design.phases];
  const [item] = phases.splice(phase, 1);
  if (item) phases.splice(target, 0, item);
  return { design: { phases }, selection: { kind: 'phase', phase: target } };
}

export function clampSelection(
  design: WorkflowDesign,
  selection: DesignSelection
): DesignSelection {
  const phase = clamp(selection.phase, design.phases.length - 1);
  if (selection.kind === 'phase') return { kind: 'phase', phase };
  const steps = design.phases[phase]?.steps.length ?? 1;
  return { kind: 'step', phase, step: clamp(selection.step, steps - 1) };
}
