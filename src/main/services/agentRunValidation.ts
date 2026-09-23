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
    const commandRef = input.gate && 'commandRef' in input.gate ? input.gate.commandRef : undefined;
    return {
      ok: false,
      error: commandRef
        ? `Unknown Main-authorized gate command: ${commandRef}`
        : 'Run gates cannot execute arbitrary commands.',
    };
  }
  return { ok: true, ...(value !== undefined ? { value } : {}) };
}
