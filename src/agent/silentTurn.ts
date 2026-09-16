import type { ProjectedMessage } from '@shared/types/agent';

/** 空轮次自动续跑时追加到当次 systemPrompt，跑完即撤。 */
export const SILENT_TURN_NUDGE = [
  'The previous assistant reply was empty: no visible text and no tool call.',
  'Continue the same user request. Call tools if work is needed, or write the answer in the reply.',
  'Do not produce another empty reply.',
].join('\n');

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
