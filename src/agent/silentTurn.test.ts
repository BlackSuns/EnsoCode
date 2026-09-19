import type { ProjectedMessage, ProjectedPart } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { isSilentAssistantTurn, POST_TOOL_EMPTY_NUDGE, silentTurnKind } from './silentTurn';

function assistant(content: ProjectedPart[], stopReason?: string): ProjectedMessage {
  return {
    role: 'assistant',
    content,
    ...(stopReason ? { stopReason } : {}),
  };
}

describe('isSilentAssistantTurn', () => {
  it('空内容 assistant 算空轮次', () => {
    expect(isSilentAssistantTurn(assistant([]))).toBe(true);
  });

  it('只有 thinking 算空轮次', () => {
    expect(isSilentAssistantTurn(assistant([{ type: 'thinking', text: 'ponder' }]))).toBe(true);
  });

  it('空白正文算空轮次', () => {
    expect(isSilentAssistantTurn(assistant([{ type: 'text', text: '  \n\t' }]))).toBe(true);
  });

  it('有可见正文不算', () => {
    expect(isSilentAssistantTurn(assistant([{ type: 'text', text: 'hello' }]))).toBe(false);
  });

  it('有 toolCall 不算', () => {
    expect(isSilentAssistantTurn(assistant([{ type: 'toolCall', id: '1', name: 'read' }]))).toBe(
      false
    );
  });

  it('有图片不算', () => {
    expect(
      isSilentAssistantTurn(assistant([{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]))
    ).toBe(false);
  });

  it('error / aborted 不算', () => {
    expect(isSilentAssistantTurn(assistant([], 'error'))).toBe(false);
    expect(isSilentAssistantTurn(assistant([], 'aborted'))).toBe(false);
  });

  it('非 assistant 或缺失不算', () => {
    expect(isSilentAssistantTurn(undefined)).toBe(false);
    expect(isSilentAssistantTurn({ role: 'user', content: [] })).toBe(false);
  });
});

describe('silentTurnKind', () => {
  it('空回复前是 user 则为 empty', () => {
    expect(
      silentTurnKind([{ role: 'user', content: [{ type: 'text', text: 'go' }] }, assistant([])])
    ).toBe('empty');
  });

  it('空回复前是 toolResult 则为 post-tool', () => {
    expect(
      silentTurnKind([
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        { role: 'assistant', content: [{ type: 'toolCall', id: '1', name: 'read' }] },
        { role: 'toolResult', toolCallId: '1', content: [{ type: 'text', text: 'ok' }] },
        assistant([]),
      ])
    ).toBe('post-tool');
  });

  it('有正文时不分类', () => {
    expect(silentTurnKind([assistant([{ type: 'text', text: 'done' }])])).toBeUndefined();
  });

  it('post-tool nudge 要求总结工具结果', () => {
    expect(POST_TOOL_EMPTY_NUDGE).toMatch(/tools completed/i);
    expect(POST_TOOL_EMPTY_NUDGE).toMatch(/final response/i);
  });
});
