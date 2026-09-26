import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { type QuickActionGitStatus, quickActions } from './quickActions';

/** 一轮结束后的快捷操作：点击即按当前界面语言发一句短消息，走与输入框相同的发送路径 */
export function QuickActionsBar({
  workspaceConversationId,
  onSend,
}: {
  workspaceConversationId: string;
  onSend: (text: string) => void;
}) {
  const { t } = useI18n();
  // undefined = 读取中，先不渲染，避免按钮先后跳出
  const [status, setStatus] = useState<QuickActionGitStatus | null>();

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.worktree.branches(workspaceConversationId).then(
      (result) => {
        if (!cancelled) setStatus(result.ok ? result.value : null);
      },
      () => {
        if (!cancelled) setStatus(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceConversationId]);

  if (status === undefined) return null;
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1">
      {quickActions(status, true).map((action) => (
        <Button
          key={action.id}
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => onSend(t(action.prompt))}
        >
          {t(action.label)}
        </Button>
      ))}
    </div>
  );
}
