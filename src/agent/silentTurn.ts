import type { ProjectedMessage } from '@shared/types/agent';

/**
 * 空轮次恢复时仅附加到本次恢复模型请求上下文，恢复轮结束或取消后即撤。
 *
 * Add only to model requests in the recovery turn, then clear it when that turn ends or is aborted.
 */
export const SILENT_TURN_NUDGE = [
  'The previous assistant reply was empty: no visible text and no tool call.',
  'Continue the same user request. Call tools if work is needed, or write the answer in the reply.',
  'Do not produce another empty reply.',
].join('\n');

export const POST_TOOL_EMPTY_NUDGE = [
  'The tools completed, but your response was empty.',
  'Provide a concise final response summarizing the result for the user.',
  'Do not produce another empty reply.',
].join(' ');

export type SilentTurnKind = 'empty' | 'post-tool';

/** 末条 assistant 对用户不可见且没有工具调用：可自动续跑一次。 */
export function isSilentAssistantTurn(message: ProjectedMessage | undefined): boolean {
  if (message?.role !== 'assistant') return false;
  if (message.stopReason === 'error' || message.stopReason === 'aborted') return false;
  let visible = false;
  for (const part of message.content) {
    if (part.type === 'toolCall') return false;
    if (part.type === 'image') return false;
    if (part.type === 'text' && part.text.trim()) visible = true;
  }
  return !visible;
}

/** 末条为空 assistant 时，根据前一条消息区分「没干活」和「工具成功却不收束」。 */
export function silentTurnKind(
  messages: ProjectedMessage[] | undefined
): SilentTurnKind | undefined {
  if (!isSilentAssistantTurn(messages?.at(-1))) return undefined;
  const previous = messages?.findLast((m, i) => i < messages.length - 1 && m.role !== 'system');
  return previous?.role === 'toolResult' ? 'post-tool' : 'empty';
}
