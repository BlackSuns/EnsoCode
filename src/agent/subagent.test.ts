import type { SpawnModelConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import { createUnifiedSubagentTool } from './subagent';

const model: SpawnModelConfig = {
  api: 'openai-completions',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test',
  modelId: 'worker',
  settingsProviderId: 'provider',
};

describe('subagent unified control', () => {
  it('normalizes model thinking before the typed Main invocation', async () => {
    const invoke = vi.fn(async (request) => ({ ok: true as const, value: request }));
    const tool = createUnifiedSubagentTool({
      agentTypes: [],
      models: [{ name: 'Provider/worker', config: model }],
      invoke,
    });
    await tool.execute(
      'call-1',
      {
        operation: 'spawn',
        description: 'implement',
        prompt: 'implement',
        model: 'Provider/worker:high',
      },
      undefined,
      undefined,
      {} as never
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'Provider/worker', thinking: 'high', wait: false }),
      undefined
    );
  });
});
