import type { CatalogEntry } from '@enso/pair';
import type { ProjectedMessage } from '@shared/types/agent';
import { Coins, Database, Gauge, type LucideIcon, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { ContextMeter } from '@/components/chat/ContextMeter';
import {
  buildUsageSegmentValues,
  toSessionUsageStats,
  type UsageSegmentId,
} from '@/components/chat/usageSegments';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { computeStats } from '@/stores/sessions/stats';

/** 与桌面默认状态栏同序同图标 */
const SEGMENTS: [UsageSegmentId, LucideIcon][] = [
  ['tokens', Coins],
  ['cache', Database],
  ['context', Gauge],
  ['speed', Zap],
];

/** 输入框下的会话统计：与桌面同口径（按已加载消息算，占用由桌面下发）；手机无悬停，四段常驻，窄屏折行。
 *  恒占一行高度，避免首条回复到达时输入框上跳。 */
export function SessionStatsLine({
  messages,
  context,
}: {
  messages: ProjectedMessage[];
  context?: CatalogEntry['context'];
}) {
  const { t } = useI18n();
  const stats = useMemo(() => computeStats(messages), [messages]);
  const values = buildUsageSegmentValues(t, toSessionUsageStats(stats, context));
  return (
    <div
      data-slot="stats-line"
      className="flex min-h-6 flex-wrap items-center justify-center gap-x-3 px-1"
    >
      {SEGMENTS.map(([id, Icon]) => {
        const value = values[id];
        if (!value) return null;
        return (
          <span
            key={id}
            className={cn(
              'flex items-center gap-1 text-[11px] tabular-nums',
              value.critical ? 'text-destructive' : 'text-muted-foreground/80'
            )}
          >
            {value.percent !== undefined ? (
              <ContextMeter percent={value.percent} critical={Boolean(value.critical)} />
            ) : (
              <Icon className="h-3 w-3 shrink-0 opacity-75" />
            )}
            {value.compact}
          </span>
        );
      })}
    </div>
  );
}
