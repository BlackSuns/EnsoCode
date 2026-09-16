import type { ProjectedMessage, ProjectedPart } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { isSilentAssistantTurn } from './silentTurn';

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
