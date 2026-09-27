import { splitTrailingJson } from '@/stores/sessions/timeline';

export interface SubagentRunLine {
  agentId: string;
  runId: string;
  status: string;
  /** 结束了才有 */
  durationMs: number | null;
}

/** 子代理 report / wait 回执拆成回答、各 run 状态，与收起显示的运行信息原文 */
export type SubagentReceiptView = {
  /** 回执前捎带的系统提醒等 */
  head: string;
  runs: SubagentRunLine[];
  /** 运行信息原文，不含单独显示的回答 */
  info: string;
} & (
  | { kind: 'report'; text: string | null; value: string | null; error: string | null }
  | { kind: 'wait'; timedOut: boolean; interrupted: boolean }
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonBlank = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

function toRunLine(value: unknown): SubagentRunLine | null {
  if (!isRecord(value)) return null;
  const { agentId, runId, status, createdAt, startedAt, finishedAt } = value;
  if (typeof agentId !== 'string' || typeof runId !== 'string' || typeof status !== 'string') {
    return null;
  }
  const start = typeof startedAt === 'number' ? startedAt : createdAt;
  return {
    agentId,
    runId,
    status,
    durationMs:
      typeof finishedAt === 'number' && typeof start === 'number'
        ? Math.max(0, finishedAt - start)
        : null,
  };
}

/** 对不上 AgentRunReport / AgentWaitReceipt 形状时返回 null，由调用方回退原文 */
export function parseSubagentReceipt(
  op: 'report' | 'wait',
  output: string | null | undefined
): SubagentReceiptView | null {
  const receipt = splitTrailingJson(output);
  if (!receipt) return null;
  const { head, value: json } = receipt;
  if (op === 'report') {
    const run = toRunLine(json.run);
    if (!run) return null;
    const { text, value, error, ...rest } = json;
    return {
      kind: 'report',
      head,
      runs: [run],
      text: nonBlank(text),
      value: value === undefined || value === null ? null : JSON.stringify(value, null, 2),
      error: nonBlank(error),
      info: JSON.stringify(rest, null, 2),
    };
  }
  if (!Array.isArray(json.runs)) return null;
  const runs = json.runs.flatMap((entry) => toRunLine(entry) ?? []);
  if (runs.length !== json.runs.length) return null;
  return {
    kind: 'wait',
    head,
    runs,
    timedOut: json.timedOut === true,
    interrupted: json.interrupted === true,
    info: JSON.stringify(json, null, 2),
  };
}
