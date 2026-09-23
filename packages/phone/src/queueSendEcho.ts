import { truncatedProjectionHead } from '@shared/projectedText';
import type { ProjectedMessage } from '@shared/types/agent';

export type QueuedCatalogItem = { id: string; text: string; hasImages?: boolean };

export type QueueSendEcho = {
  sessionId: string;
  messageId: string;
  text: string;
  hasImages?: boolean;
  /** 点击时权威区里已有几条同文 user，避免历史同文把回显吃掉 */
  priorMatches: number;
  /** 点击时权威区 user 条数；无文案（纯图片）靠多出来的 user 消费 */
  priorUserCount: number;
};

export function captureQueueSendEcho(
  queued: readonly QueuedCatalogItem[] | undefined,
  sessionId: string,
  messageId: string,
  userTexts: readonly string[]
): QueueSendEcho | null {
  const item = queued?.find((message) => message.id === messageId);
  if (!item) return null;
  const text = item.text;
  return {
    sessionId,
    messageId,
    text,
    ...(item.hasImages ? { hasImages: true } : {}),
    priorMatches: userTexts.filter((entry) => sameText(text, entry)).length,
    priorUserCount: userTexts.length,
  };
}

function sameText(text: string, delivered: string): boolean {
  if (delivered === text) return true;
  const head = truncatedProjectionHead(delivered);
  return head !== null && text.trimStart().startsWith(head);
}

export function withoutQueuedIds(
  queued: readonly QueuedCatalogItem[] | undefined,
  echoes: readonly QueueSendEcho[],
  sessionId: string
): QueuedCatalogItem[] {
  const hidden = new Set(
    echoes.filter((echo) => echo.sessionId === sessionId).map((echo) => echo.messageId)
  );
  return (queued ?? []).filter((item) => !hidden.has(item.id));
}

export function appendEchoMessages(
  messages: readonly ProjectedMessage[],
  echoes: readonly QueueSendEcho[],
  sessionId: string
): ProjectedMessage[] {
  const extra = echoes
    .filter((echo) => echo.sessionId === sessionId)
    .map((echo) => echoMessage(echo));
  return extra.length === 0 ? [...messages] : [...messages, ...extra];
}

export function retainQueueSendEchoes(
  echoes: readonly QueueSendEcho[],
  sessionId: string,
  userTexts: readonly string[],
  /** turnSettled：本会话刚从运行中收束。此时已有新 user 落地的回显一律收掉，兜底文本对不上 */
  opts?: { turnSettled?: boolean }
): QueueSendEcho[] {
  return echoes.filter((echo) => {
    if (echo.sessionId !== sessionId) return true;
    if (opts?.turnSettled && userTexts.length > echo.priorUserCount) return false;
    if (echo.text) {
      return userTexts.filter((entry) => sameText(echo.text, entry)).length <= echo.priorMatches;
    }
    return userTexts.length <= echo.priorUserCount;
  });
}

export function userTextsOf(messages: readonly ProjectedMessage[]): string[] {
  return messages.filter((message) => message.role === 'user').map(textOf);
}

function echoMessage(echo: QueueSendEcho): ProjectedMessage {
  const text = echo.text || (echo.hasImages ? '[image]' : '');
  return {
    role: 'user',
    content: text ? [{ type: 'text', text }] : [],
  };
}

function textOf(message: ProjectedMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
}
