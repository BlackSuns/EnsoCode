import { describe, expect, it } from 'vitest';
import {
  expandOauthCatalog,
  isXaiChatModelId,
  mergeFetchedOauthModels,
  resolveOauthCatalogModel,
} from './oauthCatalog';

const grok46 = {
  id: 'grok-4.6',
  name: 'Grok 4.6',
  reasoning: true,
  contextWindow: 500_000,
  maxTokens: 500_000,
  provider: 'xai',
};

describe('expandOauthCatalog', () => {
  it('给 xAI 补上 pi catalog 尚未收录的 grok-4.7，能力跟 grok-4.6', () => {
    const expanded = expandOauthCatalog('xai', [grok46]);
    expect(expanded.map((model) => model.id)).toEqual(['grok-4.6', 'grok-4.7']);
    expect(expanded[1]).toMatchObject({
      id: 'grok-4.7',
      name: 'Grok 4.7',
      reasoning: true,
      contextWindow: 500_000,
      maxTokens: 500_000,
      provider: 'xai',
    });
  });

  it('catalog 已有 grok-4.7 时不重复追加', () => {
    const existing = { ...grok46, id: 'grok-4.7', name: 'Grok 4.7' };
    expect(expandOauthCatalog('xai', [grok46, existing])).toEqual([grok46, existing]);
  });

  it('非 xAI 或缺少克隆模板时原样返回', () => {
    expect(expandOauthCatalog('anthropic', [{ id: 'claude-sonnet-4-5' }])).toEqual([
      { id: 'claude-sonnet-4-5' },
    ]);
    expect(expandOauthCatalog('xai', [{ id: 'grok-4.5', name: 'Grok 4.5' }])).toEqual([
      { id: 'grok-4.5', name: 'Grok 4.5' },
    ]);
  });
});

describe('resolveOauthCatalogModel', () => {
  it('精确命中优先于 overlay', () => {
    const exact = { id: 'grok-4.6', name: 'live' };
    expect(resolveOauthCatalogModel('xai', 'grok-4.6', [grok46], exact)).toBe(exact);
  });

  it('xAI catalog 未收录时用 overlay 解析 grok-4.7', () => {
    expect(resolveOauthCatalogModel('xai', 'grok-4.7', [grok46], undefined)).toMatchObject({
      id: 'grok-4.7',
      name: 'Grok 4.7',
      contextWindow: 500_000,
    });
  });

  it('xAI 用户手填的未知 id 克隆同厂模板，其它订阅仍视为缺失', () => {
    expect(resolveOauthCatalogModel('xai', 'grok-build-0.1', [grok46], undefined)).toMatchObject({
      id: 'grok-build-0.1',
      name: 'grok-build-0.1',
      reasoning: true,
      provider: 'xai',
    });
    expect(
      resolveOauthCatalogModel(
        'anthropic',
        'claude-mystery',
        [{ id: 'claude-sonnet-4-5' }],
        undefined
      )
    ).toBeUndefined();
  });
});

describe('isXaiChatModelId', () => {
  it('留下 grok 对话模型，丢掉 imagine / 嵌入 / 转写', () => {
    expect(isXaiChatModelId('grok-4.7')).toBe(true);
    expect(isXaiChatModelId('grok-build-0.1')).toBe(true);
    expect(isXaiChatModelId('grok-4.20-0309-reasoning')).toBe(true);
    expect(isXaiChatModelId('grok-imagine-image')).toBe(false);
    expect(isXaiChatModelId('grok-2-image')).toBe(false);
    expect(isXaiChatModelId('text-embedding-3-small')).toBe(false);
  });
});

describe('mergeFetchedOauthModels', () => {
  it('把上游新 id 接到 catalog 末尾，能力跟 grok-4.6', () => {
    const merged = mergeFetchedOauthModels([grok46], ['grok-4.6', 'grok-4.7', 'grok-build-0.1']);
    expect(merged.map((model) => model.id)).toEqual(['grok-4.6', 'grok-4.7', 'grok-build-0.1']);
    expect(merged[2]).toMatchObject({
      id: 'grok-build-0.1',
      name: 'grok-build-0.1',
      reasoning: true,
      contextWindow: 500_000,
      provider: 'xai',
    });
  });

  it('已有 id 不重复，缺模板时不加', () => {
    expect(mergeFetchedOauthModels([grok46], ['grok-4.6'])).toEqual([grok46]);
    expect(mergeFetchedOauthModels([], ['grok-4.7'])).toEqual([]);
  });
});
