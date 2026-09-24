import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StepNodeState = 'running' | 'reviewing' | 'ok' | 'error';

/** 时间线节点：圆形图标，运行中强调色转圈，出错红边 */
export function StepNode({ icon: Icon, state }: { icon: LucideIcon; state: StepNodeState }) {
  const busy = state === 'running' || state === 'reviewing';
  return (
    <span
      className={cn(
        'relative flex size-[22px] shrink-0 items-center justify-center rounded-full border text-muted-foreground',
        busy && 'border-transparent text-brand',
        state === 'error' && 'border-destructive/40 text-destructive'
      )}
    >
      <Icon className="size-3" />
      {busy && (
        <span className="absolute -inset-px animate-spin rounded-full border-[1.5px] border-brand/20 border-t-brand" />
      )}
    </span>
  );
}
