/**
 * pi 内置订阅 catalog 尚未跟上的模型。
 *
 * xAI 的 runtime.getModels 不联网发现。拉取模型时再打上游 /models，把新 id
 * 合并进来；overlay 只在断网时兜底 grok-4.7。手填的其它 xAI id 按同厂模板克隆。
 */

export interface OauthCatalogOverlay {
  id: string;
  name: string;
  cloneFrom: string;
}

export const OAUTH_CATALOG_OVERLAYS: Readonly<Record<string, readonly OauthCatalogOverlay[]>> = {
  xai: [{ id: 'grok-4.7', name: 'Grok 4.7', cloneFrom: 'grok-4.6' }],
};

const XAI_PROVIDER_ID = 'xai';

export function expandOauthCatalog<T extends { id: string }>(
  providerId: string,
  catalog: readonly T[]
): T[] {
  const overlays = OAUTH_CATALOG_OVERLAYS[providerId];
  if (!overlays?.length) return [...catalog];
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const extra: T[] = [];
  for (const overlay of overlays) {
    if (byId.has(overlay.id)) continue;
    const template = byId.get(overlay.cloneFrom);
    if (!template) continue;
    extra.push(cloneCatalogModel(template, overlay.id, overlay.name));
  }
  return extra.length === 0 ? [...catalog] : [...catalog, ...extra];
}

export function resolveOauthCatalogModel<T extends { id: string }>(
  providerId: string,
  modelId: string,
  catalog: readonly T[],
  exact: T | undefined
): T | undefined {
  if (exact) return exact;
  const expanded = expandOauthCatalog(providerId, catalog);
  const overlay = expanded.find((model) => model.id === modelId);
  if (overlay) return overlay;
  if (providerId !== XAI_PROVIDER_ID) return undefined;
  const template = expanded.find((model) => model.id === 'grok-4.6') ?? expanded[0];
  if (!template) return undefined;
  return cloneCatalogModel(template, modelId, modelId);
}

function cloneCatalogModel<T extends { id: string }>(template: T, id: string, name: string): T {
  return { ...template, id, ...(hasName(template) ? { name } : {}) };
}

function hasName(model: { id: string }): model is { id: string; name: string } {
  return 'name' in model && typeof (model as { name?: unknown }).name === 'string';
}

const XAI_NON_CHAT = /image|imagine|video|audio|tts|embed|whisper|transcribe/i;

export function isXaiChatModelId(id: string): boolean {
  const trimmed = id.trim();
  return trimmed.toLowerCase().startsWith('grok') && !XAI_NON_CHAT.test(trimmed);
}

export function mergeFetchedOauthModels<T extends { id: string }>(
  catalog: readonly T[],
  fetchedIds: readonly string[]
): T[] {
  const template = catalog.find((model) => model.id === 'grok-4.6') ?? catalog[0];
  if (!template) return [...catalog];
  const seen = new Set(catalog.map((model) => model.id));
  const extra: T[] = [];
  for (const raw of fetchedIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    extra.push(cloneCatalogModel(template, id, id));
  }
  return extra.length === 0 ? [...catalog] : [...catalog, ...extra];
}
