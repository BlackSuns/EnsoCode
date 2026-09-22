import { BUILTIN_TOOLS } from '@shared/types/builtinTools';
import { describe, expect, it, vi } from 'vitest';
import { createUnifiedSubagentTool } from './subagent';

describe('coworker compatibility migration', () => {
  it('removes the independent coworker tool while retaining coworker mode in subagent', async () => {
    expect(BUILTIN_TOOLS.map((tool) => tool.id)).not.toContain('coworker');
    const invoke = vi.fn(async (request) => ({ ok: true as const, value: request }));
    const tool = createUnifiedSubagentTool({ agentTypes: [], models: [], invoke });
    await tool.execute(
      'call-1',
      { operation: 'spawn', mode: 'coworker', description: 'review', prompt: 'review' },
      undefined,
      undefined,
      {} as never
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'spawn', mode: 'coworker', wait: false }),
      undefined
    );
  });
});
