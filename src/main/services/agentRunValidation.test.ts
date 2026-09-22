import { describe, expect, it } from 'vitest';
import { validateAgentRun } from './agentRunValidation';

describe('validateAgentRun', () => {
  it('parses and validates structured output', async () => {
    await expect(
      validateAgentRun({
        cwd: process.cwd(),
        text: 'result:\n```json\n{"ok":true}\n```',
        schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      })
    ).resolves.toEqual({ ok: true, value: { ok: true } });
  });

  it('executes argv gates without a shell and reports failure', async () => {
    await expect(
      validateAgentRun({
        cwd: process.cwd(),
        gate: { argv: [process.execPath, '-e', 'process.exit(3)'] },
      })
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/gate/i) });
  });

  it('aborts a running argv gate', async () => {
    const controller = new AbortController();
    const pending = validateAgentRun({
      cwd: process.cwd(),
      gate: { argv: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'] },
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ ok: false });
  });
});
