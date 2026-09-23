import {
  type Api,
  type AssistantMessageEventStream,
  type Context,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type SimpleStreamOptions,
  type StreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { getApiProvider, registerApiProvider } from '@earendil-works/pi-ai/compat';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { installPiCursorExecHook } from './installHook';

export const CURSOR_PROVIDER_ID = 'cursor';
const CURSOR_NATIVE_API = 'cursor-native';
const CURSOR_EXTENSION_SOURCE = '@rahularya01/pi-cursor';

let loaded = false;

/** 幂等注册 Cursor 订阅 provider（OAuth + catalog）。失败不影响其它 provider。 */
export async function loadCursorProvider(runtime: ModelRuntime): Promise<void> {
  if (loaded) return;
  loaded = true;
  installPiCursorExecHook();
  try {
    const mod = await import('@rahularya01/pi-cursor');
    const shim = {
      registerProvider: (id: string, config: unknown) => {
        (runtime.registerProvider as (id: string, config: unknown) => void)(
          id,
          wrapRuntimeProviderConfig(config)
        );
        wrapCompatApiProvider();
      },
      on: () => () => {},
      registerCommand: () => {},
      ui: {},
    };
    mod.default(shim);
  } catch (error) {
    loaded = false;
    console.warn('[cursor] extension load failed:', error);
  }
}

export function resetCursorProviderLoadForTests(): void {
  loaded = false;
}

type CursorContext = TranscriptContext & Pick<Context, 'systemPrompt' | 'tools'>;
type CursorProviderStream<TOptions extends StreamOptions> = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: TOptions
) => AssistantMessageEventStream;

/** pi 0.87 把 systemPrompt/tools 折进 transcript 的 system message，pi-cursor 1.4.36 仍读旧字段，这里还原回去 */
function restoreCursorContext(context: TranscriptContext): CursorContext {
  return {
    ...context,
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages),
  };
}

function wrapCursorStream<TOptions extends StreamOptions>(
  stream: CursorProviderStream<TOptions>
): CursorProviderStream<TOptions> {
  return (model, context, options) => stream(model, restoreCursorContext(context), options);
}

function wrapRuntimeProviderConfig(config: unknown): unknown {
  if (!config || typeof config !== 'object') return config;
  const providerConfig = config as Record<string, unknown>;
  const wrapped = { ...providerConfig };
  if (typeof wrapped.streamSimple === 'function') {
    wrapped.streamSimple = wrapCursorStream(
      wrapped.streamSimple as CursorProviderStream<SimpleStreamOptions>
    );
  }
  if (typeof wrapped.stream === 'function') {
    wrapped.stream = wrapCursorStream(wrapped.stream as CursorProviderStream<StreamOptions>);
  }
  return wrapped;
}

function wrapCompatApiProvider(): void {
  const provider = getApiProvider(CURSOR_NATIVE_API);
  if (!provider) return;

  // pi-cursor 每次注册都先写 compat 全局表再调 registerProvider，两条路径都要包；compat 每次都是新的原始 provider，不会重复包装
  registerApiProvider(
    {
      api: provider.api,
      stream: wrapCursorStream(provider.stream),
      streamSimple: wrapCursorStream(provider.streamSimple),
    },
    CURSOR_EXTENSION_SOURCE
  );
}
