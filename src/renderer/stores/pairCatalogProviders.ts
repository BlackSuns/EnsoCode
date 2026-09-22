import type { ModelProvider, PairCatalogPayload } from '@shared/types';
import {
  type OauthCredentialSnapshot,
  usableProvidersForOauthSnapshot,
} from '@/stores/oauthCredentials';

type PairProviderEntries = PairCatalogPayload['providers'];

/** 手机目录只收启用且凭证可用的 provider；密钥与账号 key 一律不下行。 */
export function toPairProviderEntries(
  providers: readonly ModelProvider[],
  snapshot: OauthCredentialSnapshot
): PairProviderEntries {
  return usableProvidersForOauthSnapshot(providers, snapshot).map((p) => ({
    id: p.id,
    name: p.name,
    models: p.models.map((m) => ({ id: m.id, ...(m.label ? { label: m.label } : {}) })),
  }));
}

/**
 * OAuth 还没有真值、且当前可见列表为空时不结算。
 * 这种空列表是加载中的暂态，下发后会被 1.5s 去重把随后的真列表吞掉。
 */
export function pairProviderSyncPlan(
  providers: readonly ModelProvider[],
  snapshot: OauthCredentialSnapshot
): { entries: PairProviderEntries; settled: boolean } {
  const entries = toPairProviderEntries(providers, snapshot);
  const status = snapshot.availability.status;
  const waiting = status === 'unloaded' || status === 'loading';
  const hasEnabledOauth = providers.some(
    (provider) => provider.enabled && provider.oauthAccountKey
  );
  return { entries, settled: !(waiting && hasEnabledOauth && entries.length === 0) };
}
