import { execFile } from 'node:child_process';
import { parseJsonFromAssistant, validateAgainstSchema } from '../../agent/structuredYield';
import type { AgentRunGate } from '../../shared/types/agent';

export async function validateAgentRun(input: {
  cwd: string;
  text?: string;
  schema?: unknown;
  gate?: AgentRunGate;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; error?: string; value?: unknown }> {
  let value: unknown;
  if (input.schema !== undefined) {
    value = parseJsonFromAssistant(input.text ?? '');
    if (value === undefined) return { ok: false, error: 'Agent did not return valid JSON.' };
    const checked = validateAgainstSchema(value, input.schema as never);
    if (!checked.ok) return { ok: false, error: checked.error ?? 'Schema validation failed.' };
  }
  if (input.gate) {
    if ('commandRef' in input.gate) {
      return { ok: false, error: `Unknown Main-authorized gate command: ${input.gate.commandRef}` };
    }
    const [file, ...args] = input.gate.argv;
    const gated = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      execFile(
        file,
        args,
        { cwd: input.cwd, shell: false, timeout: 120_000, signal: input.signal },
        (error, _stdout, stderr) =>
          resolve(
            error
              ? { ok: false, error: stderr.trim() || `Run gate failed: ${error.message}` }
              : { ok: true }
          )
      );
    });
    if (!gated.ok) return gated;
  }
  return { ok: true, ...(value !== undefined ? { value } : {}) };
}
