import { describe, expect, it } from 'vitest';
import { createContinuousMemoryFactory } from './extension';
import { OM_FOLDED, OM_OBSERVATIONS_RECORDED } from './vendor/session-ledger/types.js';

type CompactResult = { compaction?: { summary: string; details?: { type?: string } } } | undefined;

function compactHook() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  createContinuousMemoryFactory()({
    on: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler),
    registerTool: () => undefined,
    appendEntry: () => undefined,
  } as never);
  return handlers.get('session_before_compact');
}

describe('continuous memory 3.0.4 wrapper', () => {
  it('有观察时渲染 om.folded，不因覆盖缺口拒绝', async () => {
    const hook = compactHook();
    const branch = [
      { type: 'message', id: 'raw-1' },
      { type: 'message', id: 'raw-2' },
      {
        type: 'custom',
        id: 'ledger-1',
        customType: OM_OBSERVATIONS_RECORDED,
        data: {
          coversUpToId: 'raw-1',
          observations: [
            {
              id: 'aaaaaaaaaaaa',
              content: 'user asked to keep going',
              timestamp: '2026-09-12 08:00',
              relevance: 'high',
              sourceEntryIds: ['raw-1'],
              tokenCount: 8,
            },
          ],
        },
      },
      { type: 'message', id: 'keep' },
    ];
    const result = (await hook?.(
      {
        branchEntries: branch,
        signal: new AbortController().signal,
        preparation: { firstKeptEntryId: 'keep', tokensBefore: 12_000 },
      },
      { cwd: '/tmp', sessionManager: { getBranch: () => branch } }
    )) as CompactResult;
    expect(result?.compaction?.details?.type).toBe(OM_FOLDED);
    expect(result?.compaction?.summary).toContain('aaaaaaaaaaaa');
  });

  it('没有观察时不走 om.folded', async () => {
    const hook = compactHook();
    const branch = [
      { type: 'message', id: 'raw-1' },
      { type: 'message', id: 'raw-2' },
      { type: 'message', id: 'keep' },
    ];
    const result = (await hook?.(
      {
        branchEntries: branch,
        signal: new AbortController().signal,
        reason: 'overflow',
        preparation: {
          firstKeptEntryId: 'keep',
          tokensBefore: 12_000,
          previousSummary: 'KEEP THIS HISTORY',
          messagesToSummarize: [{ role: 'user', content: 'hi' }],
          turnPrefixMessages: [],
          isSplitTurn: false,
        },
      },
      {
        cwd: '/tmp',
        sessionManager: { getBranch: () => branch },
        model: { id: 'm', contextWindow: 200_000 },
        modelRegistry: { find: () => undefined, complete: async () => ({ content: [] }) },
      }
    )) as CompactResult;
    expect(result?.compaction?.details?.type === OM_FOLDED).toBe(false);
  });

  it('用户 abort 让位', async () => {
    const hook = compactHook();
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await hook?.(
        {
          branchEntries: [],
          signal: aborted.signal,
          preparation: { firstKeptEntryId: 'keep' },
        },
        { cwd: '/tmp' }
      )
    ).toBeUndefined();
  });
});
