import { Globe, SquareTerminal } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useSidePanelStore } from '@/stores/sidePanel';
import { countSidePanelTabs } from '@/stores/sidePanel/tabCounts';

export function SessionTabCounts({
  conversationId,
  row = false,
}: {
  conversationId: string;
  row?: boolean;
}) {
  const { t } = useI18n();
  const browsers = useSidePanelStore(
    (state) => countSidePanelTabs(state.layouts[conversationId]).browsers
  );
  const terminals = useSidePanelStore(
    (state) => countSidePanelTabs(state.layouts[conversationId]).terminals
  );
  if (browsers === 0 && terminals === 0) return null;
  const counts = (
    <span
      data-slot="session-tab-counts"
      className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground/70"
    >
      {browsers > 0 && (
        <span
          className="inline-flex items-center gap-0.5"
          title={t('{{n}} browsers', { n: browsers })}
        >
          <Globe className="h-3 w-3" aria-hidden />
          {browsers}
        </span>
      )}
      {terminals > 0 && (
        <span
          className="inline-flex items-center gap-0.5"
          title={t('{{n}} terminals', { n: terminals })}
        >
          <SquareTerminal className="h-3 w-3" aria-hidden />
          {terminals}
        </span>
      )}
    </span>
  );
  if (!row) return counts;
  return (
    <div data-slot="conversation-tab-counts-row" className="col-start-2 min-w-0">
      {counts}
    </div>
  );
}
