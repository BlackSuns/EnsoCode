import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

export type ToolExecuteResult = Awaited<ReturnType<ToolDefinition['execute']>>;

export function toolResultText(result: ToolExecuteResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
}

export function toolResultIsError(result: ToolExecuteResult): boolean {
  return (result as { isError?: boolean }).isError === true;
}

type ReminderProvider = {
  name: string;
  take: () => string[];
  priority: number;
};

/** 按 priority 高到低收集本轮待注入 reminder；单个 provider 失败不影响其余。 */
export class SystemReminderRegistry {
  private providers: ReminderProvider[] = [];

  register(name: string, take: () => string[], priority = 0): this {
    this.providers.push({ name, take, priority });
    return this;
  }

  takePending(): string[] {
    const ranked = [...this.providers].sort((a, b) => b.priority - a.priority);
    const blocks: string[] = [];
    for (const provider of ranked) {
      try {
        const pending = provider.take();
        if (Array.isArray(pending)) {
          for (const block of pending) {
            if (typeof block === 'string' && block.trim()) blocks.push(block);
          }
        }
      } catch {
        // fail-open：单个 provider 不得阻断工具结果
      }
    }
    return blocks;
  }
}

export function systemReminderBlock(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

export function prependToolText<T extends ToolExecuteResult>(result: T, prefix: string): T {
  if (!prefix) return result;
  const content = [...(result.content ?? [])];
  const firstText = content.find((part) => part.type === 'text');
  if (firstText && firstText.type === 'text') {
    firstText.text = `${prefix}\n\n${firstText.text}`;
  } else {
    content.unshift({ type: 'text', text: prefix });
  }
  return { ...result, content };
}

export function withSystemReminders(
  definition: ToolDefinition,
  registry: SystemReminderRegistry
): ToolDefinition {
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const result = await definition.execute(toolCallId, params, signal, onUpdate, ctx);
      const pending = registry.takePending();
      if (pending.length === 0) return result;
      const tagged = pending.map((block) =>
        block.includes('<system-reminder>') || block.includes('<background-task-update>')
          ? block
          : systemReminderBlock(block)
      );
      return prependToolText(result, tagged.join('\n\n'));
    },
  };
}
