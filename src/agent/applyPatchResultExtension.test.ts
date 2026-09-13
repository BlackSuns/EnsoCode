import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { applyPatchResultExtension, isFailedApplyPatchResult } from './applyPatchResultExtension';

type ToolResultHandler = (event: {
  toolName: string;
  content: Array<{ type: 'text'; text: string }>;
  details?: unknown;
  isError: boolean;
}) => unknown;

function handlerOf(extension: InlineExtension): ToolResultHandler {
  let handler: ToolResultHandler | undefined;
  const factory = typeof extension === 'function' ? extension : extension.factory;
  factory({
    on: vi.fn((event: string, value: ToolResultHandler) => {
      if (event === 'tool_result') handler = value;
    }),
  } as never);
  if (!handler) throw new Error('tool_result handler not registered');
  return handler;
}

describe('applyPatchResultExtension', () => {
  it.each(['partial', 'failed'] as const)(
    '%s 结果标为 isError，原 content/details 不被覆盖',
    (status) => {
      const handler = handlerOf(applyPatchResultExtension);
      const details = { kind: 'apply_patch', status, applied: ['a.ts'], failed: ['b.ts'] };
      const content = [{ type: 'text' as const, text: '原始明细' }];
      expect(handler({ toolName: 'apply_patch', content, details, isError: false })).toEqual({
        isError: true,
      });
    }
  );

  it('取消后的 generic Abort 文本不覆盖 patch details，仍严格按 details 标错', () => {
    const handler = handlerOf(applyPatchResultExtension);
    const details = {
      kind: 'apply_patch',
      status: 'partial',
      applied: ['a.ts'],
      uncertain: ['b.ts'],
    };
    expect(
      handler({
        toolName: 'apply_patch',
        content: [{ type: 'text', text: 'Operation aborted' }],
        details,
        isError: false,
      })
    ).toEqual({ isError: true });
  });

  it('只认 apply_patch 工具、严格 marker 与非 success 状态', () => {
    expect(isFailedApplyPatchResult('apply_patch', { kind: 'apply_patch', status: 'failed' })).toBe(
      true
    );
    expect(
      isFailedApplyPatchResult('apply_patch', { kind: 'apply_patch', status: 'success' })
    ).toBe(false);
    expect(isFailedApplyPatchResult('edit', { kind: 'apply_patch', status: 'failed' })).toBe(false);
    expect(isFailedApplyPatchResult('apply_patch', { status: 'failed' })).toBe(false);
    expect(
      isFailedApplyPatchResult('apply_patch', { kind: 'apply_patch', status: 'unknown' })
    ).toBe(false);
  });
});
