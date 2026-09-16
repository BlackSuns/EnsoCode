import type { ModelApiKind } from '@shared/types/llm';

const BOOLEAN_COMPAT_KEYS = [
  'supportsStore',
  'supportsDeveloperRole',
  'supportsReasoningEffort',
  'supportsUsageInStreaming',
  'supportsFinishReason',
  'requiresToolResultName',
  'requiresAssistantAfterToolResult',
  'requiresThinkingAsText',
  'requiresReasoningContentOnAssistantMessages',
  'zaiToolStream',
  'supportsThinkingTokenBudget',
  'supportsOpenAIGrammarTools',
  'supportsStrictMode',
  'sendSessionAffinityHeaders',
  'supportsLongCacheRetention',
] as const;

const THINKING_FORMATS = [
  'openai',
  'openrouter',
  'deepseek',
  'together',
  'baseten',
  'zai',
  'qwen',
  'chat-template',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
] as const;

const MAX_TOKENS_FIELDS = ['max_completion_tokens', 'max_tokens'] as const;

type ThinkingFormat = (typeof THINKING_FORMATS)[number];
type MaxTokensField = (typeof MAX_TOKENS_FIELDS)[number];

/** 自定义 openai-completions 通道上从 catalog 透传 / 中转兜底的 wire 字段。 */
export type CustomModelWireCompat = {
  [K in (typeof BOOLEAN_COMPAT_KEYS)[number]]?: boolean;
} & {
  thinkingFormat?: ThinkingFormat;
  maxTokensField?: MaxTokensField;
  chatTemplateArgs?: Record<string, unknown>;
  chatTemplateKwargs?: Record<string, unknown>;
};

/**
 * 自定义 API Key provider 的 compat。
 * pi 按 provider 名 + baseUrl 猜；enso-* 中转站会被当成标准 OpenAI，从而把
 * system 写成 developer（GLM Flash → 400 code 1214）。
 */
export function resolveCustomModelCompat(
  api: ModelApiKind,
  baseUrl: string,
  catalog?: unknown
): CustomModelWireCompat | undefined {
  if (api !== 'openai-completions') return undefined;
  const fromCatalog = pickCatalogCompat(catalog);
  if (leavesDetectCompat(baseUrl)) return fromCatalog;
  return { supportsDeveloperRole: false, ...fromCatalog };
}

/** 同 id 可能来自多个 openai-completions provider；中转只在 compat 一致或 host 命中时抄。 */
export function selectCatalogEntryForCompat(
  models: readonly unknown[],
  api: ModelApiKind,
  baseUrl: string,
  modelId: string
): unknown | undefined {
  if (api !== 'openai-completions' || !modelId) return undefined;
  const candidates: Record<string, unknown>[] = [];
  for (const item of models) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    if (rec.id !== modelId || rec.api !== 'openai-completions') continue;
    candidates.push(rec);
  }
  if (candidates.length === 0) return undefined;
  const host = hostnameOf(baseUrl);
  if (host) {
    const hit = candidates.find((entry) => hostnameOf(catalogBaseUrl(entry)) === host);
    if (hit) return hit;
  }
  const picked = candidates.map((entry) => pickCatalogCompat(entry));
  const fingerprints = picked.map((entry) => stableStringify(entry ?? null));
  if (fingerprints.every((item) => item === fingerprints[0])) return candidates[0];
  const consensus = intersectCompat(picked);
  return consensus ? { api: 'openai-completions', compat: consensus } : undefined;
}

function catalogBaseUrl(entry: Record<string, unknown>): string {
  return typeof entry.baseUrl === 'string' ? entry.baseUrl : '';
}

function intersectCompat(
  picked: Array<CustomModelWireCompat | undefined>
): CustomModelWireCompat | undefined {
  const present = picked.map((entry) => entry ?? {});
  const keys = new Set<string>();
  for (const entry of present) {
    for (const key of Object.keys(entry)) keys.add(key);
  }
  const out: CustomModelWireCompat = {};
  const first = present[0];
  if (!first) return undefined;
  for (const key of keys) {
    if (!Object.hasOwn(first, key)) continue;
    const expected = stableStringify(first[key as keyof CustomModelWireCompat]);
    if (
      present.every(
        (entry) =>
          Object.hasOwn(entry, key) &&
          stableStringify(entry[key as keyof CustomModelWireCompat]) === expected
      )
    ) {
      (out as Record<string, unknown>)[key] = first[key as keyof CustomModelWireCompat];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(rec[key])}`)
    .join(',')}}`;
}

function pickCatalogCompat(catalog: unknown): CustomModelWireCompat | undefined {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return undefined;
  const rec = catalog as Record<string, unknown>;
  if (typeof rec.api === 'string' && rec.api !== 'openai-completions') return undefined;
  const raw = rec.compat;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  const out: CustomModelWireCompat = {};
  for (const key of BOOLEAN_COMPAT_KEYS) {
    if (typeof entry[key] === 'boolean') out[key] = entry[key];
  }
  if (isThinkingFormat(entry.thinkingFormat)) out.thinkingFormat = entry.thinkingFormat;
  if (isMaxTokensField(entry.maxTokensField)) out.maxTokensField = entry.maxTokensField;
  if (isPlainObject(entry.chatTemplateArgs)) out.chatTemplateArgs = entry.chatTemplateArgs;
  if (isPlainObject(entry.chatTemplateKwargs)) out.chatTemplateKwargs = entry.chatTemplateKwargs;
  return Object.keys(out).length > 0 ? out : undefined;
}

function isThinkingFormat(value: unknown): value is ThinkingFormat {
  return typeof value === 'string' && (THINKING_FORMATS as readonly string[]).includes(value);
}

function isMaxTokensField(value: unknown): value is MaxTokensField {
  return typeof value === 'string' && (MAX_TOKENS_FIELDS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function leavesDetectCompat(baseUrl: string): boolean {
  return (
    isOfficialOpenAIBaseUrl(baseUrl) ||
    isOpenRouterBaseUrl(baseUrl) ||
    isAzureOpenAIBaseUrl(baseUrl)
  );
}

function isOfficialOpenAIBaseUrl(baseUrl: string): boolean {
  const host = hostnameOf(baseUrl);
  return host === 'api.openai.com' || host.endsWith('.openai.com');
}

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  const host = hostnameOf(baseUrl);
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

function isAzureOpenAIBaseUrl(baseUrl: string): boolean {
  const host = hostnameOf(baseUrl);
  return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com');
}

function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}
