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

  it('rejects unknown command refs without executing a process', async () => {
    await expect(
      validateAgentRun({
        cwd: process.cwd(),
        gate: { commandRef: 'pnpm test' },
      })
    ).resolves.toEqual({
      ok: false,
      error: 'Unknown Main-authorized gate command: pnpm test',
    });
  });

  it('rejects a gate that is not a command ref', async () => {
    await expect(
      validateAgentRun({
        cwd: process.cwd(),
        gate: { argv: [process.execPath, '-e', 'process.exit(3)'] } as never,
      })
    ).resolves.toEqual({ ok: false, error: 'Run gates cannot execute arbitrary commands.' });
  });
});
