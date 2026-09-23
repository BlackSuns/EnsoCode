/**
 * pi provider 扩展点的类型与事件流。
 *
 * provider 相关类型从 `ModelRuntime` 的公开签名上剥出来。
 * 0.87 起请求上下文是 transcript：系统提示和工具声明在 system message 里，
 * 用 pi-ai 的回放函数读取，不能再读 `context.systemPrompt` / `context.tools`。
 */
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export type ProviderConfigInput = Parameters<ModelRuntime['registerProvider']>[1];

export type PiOauthConfig = NonNullable<ProviderConfigInput['oauth']>;
/** `{refresh, access, expires, [key: string]: unknown}` —— 额外字段（projectId/email）不会被 pi 拒 */
export type PiOauthCredentials = Parameters<PiOauthConfig['getApiKey']>[0];
export type PiLoginCallbacks = Parameters<PiOauthConfig['login']>[0];

export type PiModelSpec = NonNullable<ProviderConfigInput['models']>[number];
export type PiRefreshModelsContext = Parameters<
  NonNullable<ProviderConfigInput['refreshModels']>
>[0];

type PiStreamSimple = NonNullable<ProviderConfigInput['streamSimple']>;
export type PiModel = Parameters<PiStreamSimple>[0];
export type PiContext = Parameters<PiStreamSimple>[1];
export type PiStreamOptions = NonNullable<Parameters<PiStreamSimple>[2]>;
export type PiEventStream = ReturnType<PiStreamSimple>;
export type PiAssistantEvent = Parameters<PiEventStream['push']>[0];

export type PiMessage = PiContext['messages'][number];
export type PiAssistantMessage = Extract<PiMessage, { role: 'assistant' }>;
export type PiToolResultMessage = Extract<PiMessage, { role: 'toolResult' }>;
export type PiContentBlock = PiAssistantMessage['content'][number];
export type PiTextContent = Extract<PiContentBlock, { type: 'text' }>;
export type PiThinkingContent = Extract<PiContentBlock, { type: 'thinking' }>;
export type PiToolCall = Extract<PiContentBlock, { type: 'toolCall' }>;
export type PiTool = ReturnType<typeof getCurrentTools>[number];

export function currentSystemPrompt(context: PiContext): string {
  return getCurrentSystemPrompt(context.messages);
}

export function currentTools(context: PiContext): PiTool[] {
  return getCurrentTools(context.messages);
}
export type PiUsage = PiAssistantMessage['usage'];
export type PiStopReason = PiAssistantMessage['stopReason'];

/** 全零 usage：订阅计费，成本一律 0 */
export function emptyUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * pi `AssistantMessageEventStream` 的本地等价实现。
 *
 * 为什么自己写：pi 的 `createAssistantMessageEventStream()` 只在 pi-ai 里导出，
 * 而 pi-ai 不可 import（见文件头）。这个类复刻了 pi `EventStream` 的全部对外语义
 * —— push 入队、end 收尾、异步迭代、`result()` 在终止事件（done/error）时兑现 ——
 * 所以对消费侧行为一致。pi 内部没有任何 `instanceof AssistantMessageEventStream`
 * 判断（已在 dist 里全量搜过），因此边界上的类型断言是安全的。
 */
class LocalAssistantEventStream {
  private queue: PiAssistantEvent[] = [];
  private waiting: ((result: IteratorResult<PiAssistantEvent>) => void)[] = [];
  private finished = false;
  private readonly resolveFinal: (message: PiAssistantMessage) => void;
  private readonly finalPromise: Promise<PiAssistantMessage>;

  constructor() {
    const { promise, resolve } = Promise.withResolvers<PiAssistantMessage>();
    this.finalPromise = promise;
    this.resolveFinal = resolve;
  }

  push(event: PiAssistantEvent): void {
    if (this.finished) return;
    if (event.type === 'done') {
      this.finished = true;
      this.resolveFinal(event.message);
    } else if (event.type === 'error') {
      this.finished = true;
      this.resolveFinal(event.error);
    }

    const waiter = this.waiting.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  end(result?: PiAssistantMessage): void {
    this.finished = true;
    if (result !== undefined) this.resolveFinal(result);
    for (const waiter of this.waiting.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<PiAssistantEvent> {
    return {
      next: (): Promise<IteratorResult<PiAssistantEvent>> => {
        const queued = this.queue.shift();
        if (queued !== undefined) return Promise.resolve({ value: queued, done: false });
        if (this.finished) return Promise.resolve({ value: undefined as never, done: true });
        const { promise, resolve } = Promise.withResolvers<IteratorResult<PiAssistantEvent>>();
        this.waiting.push(resolve);
        return promise;
      },
    };
  }

  result(): Promise<PiAssistantMessage> {
    return this.finalPromise;
  }
}

/** 建一条可写的事件流；返回类型对齐 pi 的 `AssistantMessageEventStream`（见类注释） */
export function createEventStream(): PiEventStream {
  // pi 的类带私有字段（标称类型），结构化等价对象无法直接赋值，只能在此处断言一次
  return new LocalAssistantEventStream() as unknown as PiEventStream;
}
