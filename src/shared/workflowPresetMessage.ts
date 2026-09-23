/**
 * 侧边栏触发预设工作流时发出的用户消息：块内 JSON 即 workflow 工具入参，
 * 气泡按块渲染成卡片，块后的英文说明只给模型看。
 */
const BLOCK = /^<workflow-preset name="([^"]*)">\n(\{.*\})\n<\/workflow-preset>(?:\n\n[\s\S]*)?$/;
const INSTRUCTION =
  'Run this saved workflow preset now: call the workflow tool with exactly the JSON above. Do not write your own script. When it finishes, summarize the result.';

const ENTITIES: Record<string, string> = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' };
const escapeAttr = (value: string) => value.replace(/[&"<>]/g, (ch) => ENTITIES[ch] ?? ch);
const unescapeAttr = (value: string) =>
  value.replace(/&(amp|quot|lt|gt);/g, (entity) =>
    entity === '&amp;' ? '&' : entity === '&quot;' ? '"' : entity === '&lt;' ? '<' : '>'
  );

export interface WorkflowPresetMessage {
  id: string;
  name: string;
  args: [string, string][];
}

export function buildWorkflowPresetMessage(input: {
  id: string;
  name: string;
  args: Record<string, string>;
}): string {
  const payload = JSON.stringify({
    preset: input.id,
    ...(Object.keys(input.args).length > 0 ? { args: input.args } : {}),
  });
  return `<workflow-preset name="${escapeAttr(input.name)}">\n${payload}\n</workflow-preset>\n\n${INSTRUCTION}`;
}

export function parseWorkflowPresetMessage(text: string): WorkflowPresetMessage | null {
  const match = BLOCK.exec(text);
  if (!match) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(match[2] ?? '');
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { preset, args = {} } = payload as { preset?: unknown; args?: unknown };
  if (typeof preset !== 'string' || !preset) return null;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const entries = Object.entries(args);
  if (entries.some(([, value]) => typeof value !== 'string')) return null;
  return { id: preset, name: unescapeAttr(match[1] ?? ''), args: entries as [string, string][] };
}
