import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { ANTIGRAVITY_PROVIDER_ID } from '@shared/providers/antigravity';
import { DEVIN_PROVIDER_ID } from '@shared/providers/devin';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_PROVIDER_ID, loadCursorProvider } from './cursor/loadProvider';
import { initializeWorkerRuntime } from './supervisor';

vi.mock('./cursor/loadProvider', () => ({
  CURSOR_PROVIDER_ID: 'cursor',
  loadCursorProvider: vi.fn().mockResolvedValue(undefined),
}));

describe('initializeWorkerRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([ANTIGRAVITY_PROVIDER_ID, DEVIN_PROVIDER_ID, CURSOR_PROVIDER_ID])(
    '%s 联网刷新失败时仍刷新其余 provider 并返回 runtime',
    async (rejectedProviderId) => {
      const runtime = {
        registerProvider: vi.fn(),
        refresh: vi.fn(({ providers }: { providers: string[] }) =>
          providers[0] === rejectedProviderId
            ? Promise.reject(new Error('network unavailable'))
            : Promise.resolve({ aborted: false, errors: new Map() })
        ),
      } as unknown as ModelRuntime;

      await expect(initializeWorkerRuntime(runtime)).resolves.toBe(runtime);

      expect(loadCursorProvider).toHaveBeenCalledWith(runtime);
      expect(runtime.refresh).toHaveBeenCalledTimes(3);
      expect(runtime.registerProvider).toHaveBeenCalledWith(
        ANTIGRAVITY_PROVIDER_ID,
        expect.anything()
      );
      expect(runtime.registerProvider).toHaveBeenCalledWith(DEVIN_PROVIDER_ID, expect.anything());
      for (const providerId of [ANTIGRAVITY_PROVIDER_ID, DEVIN_PROVIDER_ID, CURSOR_PROVIDER_ID]) {
        expect(runtime.refresh).toHaveBeenCalledWith({
          providers: [providerId],
          allowNetwork: true,
        });
      }
    }
  );
});
