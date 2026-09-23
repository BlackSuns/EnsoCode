import type { AgentSession, InlineExtension } from '@earendil-works/pi-coding-agent';
import { projectMessage } from './projection';
import {
  isSilentAssistantTurn,
  POST_TOOL_EMPTY_NUDGE,
  SILENT_TURN_NUDGE,
  type SilentTurnKind,
} from './silentTurn';
import { transcriptMessages } from './transcript';

/**
 * 空回复恢复：`turn_end` 用 context_edit 从模型上下文拿掉空 assistant 并 continue，
 * 恢复轮的请求经 context hook 临时追加 nudge。轮次类型看最近的 user/toolResult，跳过 system entry。
 */
export function silentTurnRecoveryExtension(
  onRecovery: (kind: SilentTurnKind) => void
): InlineExtension {
  return {
    name: 'silent-turn-recovery',
    hidden: true,
    factory: (pi) => {
      let recoveredThisRun = false;
      let activeNudge: string | undefined;

      pi.on('agent_start', () => {
        recoveredThisRun = false;
        activeNudge = undefined;
      });

      pi.on('context', (event, context) => {
        if (!activeNudge) return;
        if (context.signal?.aborted) {
          activeNudge = undefined;
          return;
        }
        return {
          messages: [
            ...event.messages,
            {
              role: 'user',
              content: [{ type: 'text', text: activeNudge }],
              timestamp: Date.now(),
            },
          ],
        };
      });

      pi.on('turn_end', (event, context) => {
        if (event.outcome !== 'completed' || context.signal?.aborted) {
          activeNudge = undefined;
          return;
        }

        if (activeNudge) {
          if (
            event.message.role === 'assistant' &&
            event.message.content.some((part) => part.type === 'toolCall')
          ) {
            return;
          }
          activeNudge = undefined;
          return;
        }

        if (recoveredThisRun || event.message.role !== 'assistant') return;
        const assistant = projectMessage(event.message);
        if (!isSilentAssistantTurn(assistant ?? undefined)) return;

        const branch = context.sessionManager.getBranch();
        const currentEntryIndex = branch.findIndex((entry) => entry.id === event.messageEntryId);
        if (currentEntryIndex < 0) return;
        const previousEntry = branch
          .slice(0, currentEntryIndex)
          .reverse()
          .find(
            (entry) =>
              entry.type === 'message' &&
              (entry.message.role === 'user' || entry.message.role === 'toolResult')
          );
        const previous = previousEntry?.type === 'message' ? previousEntry.message : undefined;
        const previousMessage = projectMessage(previous);
        if (previousMessage?.role !== 'user' && previousMessage?.role !== 'toolResult') return;

        const kind: SilentTurnKind = previousMessage.role === 'toolResult' ? 'post-tool' : 'empty';
        recoveredThisRun = true;
        activeNudge = kind === 'post-tool' ? POST_TOOL_EMPTY_NUDGE : SILENT_TURN_NUDGE;
        onRecovery(kind);

        return {
          entries: [
            ...event.entries,
            {
              type: 'context_edit',
              targetId: event.messageEntryId,
              replacement: null,
            },
          ],
          continue: true,
        };
      });
    },
  };
}

/** 手动重试：把最新 assistant 从模型上下文拿掉，jsonl 原条目保留 */
export function editLatestAssistantForRetry(session: AgentSession): boolean {
  const projection = session.sessionManager.buildSessionProjection();
  const latestVisible = [...projection.entries]
    .reverse()
    .find((entry) => entry.messages.length > 0);
  if (
    latestVisible?.sourceEntry.type !== 'message' ||
    latestVisible.sourceEntry.message.role !== 'assistant' ||
    latestVisible.messages.at(-1)?.role !== 'assistant'
  ) {
    return false;
  }

  session.sessionManager.appendContextEdit(latestVisible.sourceEntry.id, null);
  session.refreshContext();
  return true;
}

/** context_edit 只作用于模型上下文，渲染层记录仍展示原始消息 */
export function buildSessionDisplayMessages(
  session: AgentSession,
  contextMessages: unknown[] = session.messages as unknown[]
): unknown[] {
  const manager = session.sessionManager as AgentSession['sessionManager'] & {
    buildSessionProjection?: AgentSession['sessionManager']['buildSessionProjection'];
  };
  const projection = manager.buildSessionProjection?.();
  if (!projection) return transcriptMessages(manager, contextMessages);

  const editedTargets = new Set<string>();
  for (const entry of manager.getBranch()) {
    if (entry.type === 'context_edit') editedTargets.add(entry.targetId);
  }

  const displayContext = projection.entries.flatMap((entry) => {
    if (entry.sourceEntry.type === 'message' && editedTargets.has(entry.sourceEntry.id)) {
      return [entry.sourceEntry.message];
    }
    return entry.messages;
  });
  return transcriptMessages(manager, displayContext);
}
