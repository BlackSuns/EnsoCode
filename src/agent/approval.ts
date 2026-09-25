import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalMode,
  ApprovalRequestInfo,
} from '@shared/types/agent';
import { extractWriteTargetPaths } from './writeScope';

interface PendingApproval {
  info: ApprovalRequestInfo;
  settle(result: 'allow' | 'deny' | 'block' | 'cancel'): void;
}

export type ApprovalReviewFn = (
  info: ApprovalRequestInfo,
  signal: AbortSignal | undefined
) => Promise<{ decision: 'auto_allow' | 'ask_user' | 'block'; rationale?: string }>;

export interface ApprovalGateOptions {
  review?: ApprovalReviewFn;
}

/**
 * 会话级审批门：worker 侧持有 pending 与「本会话总是允许」记忆。
 * fail-closed：cancelAll / abort 一律按取消收尾，绝不放行。
 */
export class ApprovalGate {
  private sessionAllowed = new Set<string>();
  private pending = new Map<string, PendingApproval>();
  /** 外层已批准的单次调用（Plan 模式强制询问后），内层 withApproval 消费一次免审 */
  private granted = new Set<string>();
  private counter = 0;

  constructor(
    public mode: ApprovalMode,
    private readonly onRequest: (info: ApprovalRequestInfo) => void,
    private readonly onResolve: (requestId: string) => void,
    private readonly options?: ApprovalGateOptions
  ) {}

  needsApproval(kind: ApprovalKind, tool: string): boolean {
    if (this.mode === 'full') return false;
    if (this.mode === 'auto-edits' && (kind === 'file-edit' || kind === 'file-write')) return false;
    return !this.sessionAllowed.has(tool);
  }

  grant(toolCallId: string): void {
    this.granted.add(toolCallId);
  }

  takeGrant(toolCallId: string | undefined): boolean {
    return toolCallId !== undefined && this.granted.delete(toolCallId);
  }

  /** 挂起等待用户决策；signal abort → cancel。planMode：跳过代审直接问人，且不记本会话允许 */
  ask(
    tool: string,
    kind: ApprovalKind,
    summary: string,
    signal: AbortSignal | undefined,
    toolCallId?: string,
    filePaths?: string[],
    options?: { planMode?: boolean }
  ): Promise<'allow' | 'deny' | 'block' | 'cancel'> {
    const requestId = `apr-${++this.counter}-${Date.now()}`;
    const info: ApprovalRequestInfo = {
      requestId,
      tool,
      kind,
      summary,
      ...(filePaths?.length ? { filePaths: [...filePaths] } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(options?.planMode ? { planMode: true } : {}),
    };
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: 'allow' | 'deny' | 'block' | 'cancel') => {
        if (settled) return;
        settled = true;
        this.pending.delete(requestId);
        signal?.removeEventListener('abort', onAbort);
        this.onResolve(requestId);
        resolve(result);
      };
      const onAbort = () => settle('cancel');
      this.pending.set(requestId, { info, settle });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        settle('cancel');
        return;
      }
      const review =
        this.mode === 'assistant' && !options?.planMode ? this.options?.review : undefined;
      if (!review) {
        this.onRequest(info);
        return;
      }
      this.onRequest({ ...info, phase: 'reviewing' });
      void Promise.resolve()
        .then(() => review(info, signal))
        .then((result) => {
          if (settled) return;
          if (result.decision === 'auto_allow') {
            settle('allow');
            return;
          }
          if (result.decision === 'block') {
            settle('block');
            return;
          }
          this.pending.set(requestId, { info, settle });
          this.onRequest(info);
        })
        .catch(() => {
          if (!settled) this.onRequest(info);
        });
    });
  }

  /** 渲染层决策入口 */
  respond(requestId: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    if (decision === 'allowSession' && !entry.info.planMode)
      this.sessionAllowed.add(entry.info.tool);
    entry.settle(decision === 'deny' ? 'deny' : 'allow');
  }

  /** abort / 会话终止：全部按取消收尾 */
  cancelAll(): void {
    for (const entry of [...this.pending.values()]) entry.settle('cancel');
  }

  snapshot(): ApprovalRequestInfo[] {
    return [...this.pending.values()].map((entry) => entry.info);
  }
}

/** 从工具参数提取审批展示文本：命令全文 / 文件路径 / 参数预览 */
export function summarizeApproval(kind: ApprovalKind, params: unknown, toolName = 'edit'): string {
  const record = (params ?? {}) as Record<string, unknown>;
  if (kind === 'command' && typeof record.command === 'string') return record.command;
  if (kind === 'file-edit' || kind === 'file-write') {
    const targets = extractWriteTargetPaths(toolName, params);
    if (targets.length > 0) return targets.join('\n');
  }
  try {
    return JSON.stringify(record).slice(0, 300);
  } catch {
    return '';
  }
}

/** 给工具包一道审批门：deny/cancel 抛错（pi 转 isError 工具结果，轮继续） */
export function withApproval(
  gate: ApprovalGate,
  kind: ApprovalKind,
  definition: ToolDefinition
): ToolDefinition {
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!gate.takeGrant(toolCallId) && gate.needsApproval(kind, definition.name)) {
        const filePaths =
          kind === 'file-edit' || kind === 'file-write'
            ? extractWriteTargetPaths(definition.name, params)
            : undefined;
        const result = await gate.ask(
          definition.name,
          kind,
          summarizeApproval(kind, params, definition.name),
          signal,
          toolCallId,
          filePaths
        );
        if (result === 'block') throw new Error('Assistant approval blocked this operation');
        if (result === 'deny') throw new Error('User denied this operation');
        if (result === 'cancel') throw new Error('Approval cancelled');
      }
      return definition.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}
