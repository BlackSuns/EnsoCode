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
 * 注册 Pi 生命周期适配器：在 `turn_end` 用 canonical edit 省略空 assistant，并在后续请求的 context hook 临时附加 nudge。轮次类型从最近的 user/toolResult 判断，跳过 Pi 插入的 system snapshot entry。
 *
 * Register the Pi lifecycle adapter: omit an empty assistant with a canonical edit at `turn_end`, and add the nudge temporarily in the next request's context hook. Classify the turn from the latest user/toolResult while skipping system snapshot entries inserted by Pi.
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

/**
 * 将最新 assistant 从 Pi canonical model context 中省略，而不删除或改写原始 session entry。
 *
 * Omit the latest assistant from Pi's canonical model context without deleting or rewriting its raw session entry.
 */
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

/**
 * 保持 Pi `context_edit` 的显示语义：模型上下文采用 edit，worker transcript 继续展示原始消息。
 *
 * Preserve Pi `context_edit` display semantics: use edits for model context while keeping original messages in the worker transcript.
 */
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
