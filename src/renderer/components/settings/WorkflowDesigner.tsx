import type {
  WorkflowDesign,
  WorkflowDesignPhase,
  WorkflowDesignStep,
} from '@shared/types/workflow';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import { Z_INDEX } from '@/lib/z-index';

/** 与运行时 agent 上限一致 */
const MAX_STEPS = 32;
/** Select 不适合空串值，用哨兵表示「默认类型」 */
const DEFAULT_TYPE = '__default__';

export const newDesignStep = (agentType = 'scout'): WorkflowDesignStep => ({
  label: '',
  agentType,
  prompt: '',
});

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function WorkflowDesigner({
  design,
  agentTypes,
  argKeys,
  onChange,
}: {
  design: WorkflowDesign;
  agentTypes: string[];
  argKeys: string[];
  onChange: (design: WorkflowDesign) => void;
}) {
  const { t } = useI18n();
  const phases = design.phases;
  const total = phases.reduce((sum, phase) => sum + phase.steps.length, 0);
  const defaultType = agentTypes.includes('scout') ? 'scout' : '';

  const setPhases = (next: WorkflowDesignPhase[]) => onChange({ phases: next });
  const patchPhase = (index: number, next: Partial<WorkflowDesignPhase>) =>
    setPhases(phases.map((phase, i) => (i === index ? { ...phase, ...next } : phase)));
  const patchStep = (pi: number, si: number, next: Partial<WorkflowDesignStep>) =>
    patchPhase(pi, {
      steps: (phases[pi]?.steps ?? []).map((step, i) => (i === si ? { ...step, ...next } : step)),
    });

  const typeItems = (current: string) => {
    const names = current && !agentTypes.includes(current) ? [...agentTypes, current] : agentTypes;
    return [
      { value: DEFAULT_TYPE, label: t('Default (worker)') },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  };

  return (
    <div className="w-full space-y-1.5">
      {phases.map((phase, pi) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 阶段无稳定 id，内容全受控
        <React.Fragment key={pi}>
          {pi > 0 && <ArrowDown className="mx-auto h-4 w-4 text-muted-foreground" />}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 font-medium text-muted-foreground text-xs">
                {t('Phase {{n}}', { n: pi + 1 })}
              </span>
              <Input
                size="sm"
                className="flex-1"
                placeholder={t('Phase title')}
                value={phase.title}
                onChange={(e) => patchPhase(pi, { title: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Move up')}
                disabled={pi === 0}
                onClick={() => setPhases(move(phases, pi, pi - 1))}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Move down')}
                disabled={pi === phases.length - 1}
                onClick={() => setPhases(move(phases, pi, pi + 1))}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Delete')}
                disabled={phases.length === 1}
                onClick={() => setPhases(phases.filter((_, i) => i !== pi))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {phase.steps.map((step, si) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 步骤无稳定 id，内容全受控
                <div key={si} className="space-y-1.5 rounded-md border bg-background p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      size="sm"
                      className="min-w-0 flex-1"
                      placeholder={t('Label')}
                      value={step.label}
                      onChange={(e) => patchStep(pi, si, { label: e.target.value })}
                    />
                    <Select
                      items={typeItems(step.agentType)}
                      value={step.agentType || DEFAULT_TYPE}
                      onValueChange={(value) =>
                        patchStep(pi, si, {
                          agentType: value === DEFAULT_TYPE ? '' : String(value ?? ''),
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-32 min-w-0 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                        {typeItems(step.agentType).map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('Remove')}
                      disabled={phase.steps.length === 1}
                      onClick={() =>
                        patchPhase(pi, { steps: phase.steps.filter((_, i) => i !== si) })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                  <Textarea
                    rows={3}
                    className="text-xs"
                    placeholder={t('Prompt')}
                    value={step.prompt}
                    onChange={(e) => patchStep(pi, si, { prompt: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="xs"
              disabled={total >= MAX_STEPS}
              onClick={() =>
                patchPhase(pi, { steps: [...phase.steps, newDesignStep(defaultType)] })
              }
            >
              <Plus />
              {t('Add parallel step')}
            </Button>
          </div>
        </React.Fragment>
      ))}
      <Button
        variant="outline"
        size="xs"
        disabled={total >= MAX_STEPS}
        onClick={() => setPhases([...phases, { title: '', steps: [newDesignStep(defaultType)] }])}
      >
        <Plus />
        {t('Add phase')}
      </Button>
      <p className="text-muted-foreground text-xs">
        {t(
          'Steps in a phase run in parallel; phases run in order. In prompts, {{argToken}} inserts an argument and {{prevToken}} inserts the previous phase output.',
          {
            argToken:
              argKeys.length > 0
                ? argKeys.map((key) => `{{args.${key}}}`).join(' ')
                : '{{args.key}}',
            prevToken: '{{prev}}',
          }
        )}
      </p>
    </div>
  );
}
