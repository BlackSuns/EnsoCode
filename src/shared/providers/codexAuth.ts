/**
 * Codex Desktop / CLI 登录态（`~/.codex/auth.json`）与 pi openai-codex 凭证之间的桥接。
 *
 * 两边用的是同一个 OAuth client，token 可直接互用；差别只在文件形状：
 * Codex 存 `tokens.{access_token, refresh_token, account_id}` 且不记过期时间，
 * pi 需要 `{access, refresh, expires, accountId}`，expires 从 access JWT 的 `exp` 解出。
 *
 * 导入的账号带 `codexLinked` 标记，与 Codex 共用同一条 token 链：OpenAI 每次刷新都轮换
 * refresh token、旧的立即作废（再用回 `refresh_token_reused`），各自刷新必有一方掉线。
 * 所以照搬 Codex 多进程之间的约定：刷新前先重读 Codex 文件，它已刷新过就直接沿用；
 * 否则由本应用刷新并写回。Codex 刷新 / 遇 401 前同样先重读磁盘，会接住我们写入的 token。
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export const CODEX_PROVIDER_ID = 'openai-codex';
export const defaultCodexAuthPath = (): string => path.join(os.homedir(), '.codex', 'auth.json');

export interface CodexOauthCredential {
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

export type ParseCodexAuthResult =
  | { status: 'ok'; credential: CodexOauthCredential }
  /** 文件存在但没有 ChatGPT 登录态（API key 模式或字段缺失） */
  | { status: 'not-logged-in' }
  | { status: 'invalid' };

const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
/** 与 pi 触发刷新的窗口一致：剩余不足 5 分钟即视为需要刷新 */
const MIN_VALIDITY_MS = 5 * 60 * 1000;

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    return obj(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
  } catch {
    return {};
  }
}

const claimAccountId = (access: string): string | null =>
  nonEmpty(obj(decodeJwtPayload(access)[OPENAI_AUTH_CLAIM]).chatgpt_account_id);

function jwtExpiresMs(access: string): number {
  const exp = decodeJwtPayload(access).exp;
  return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
}

export function parseCodexAuthJson(raw: string): ParseCodexAuthResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'invalid' };

  const tokens = obj((parsed as Record<string, unknown>).tokens);
  const access = nonEmpty(tokens.access_token);
  const refresh = nonEmpty(tokens.refresh_token);
  if (!access || !refresh) return { status: 'not-logged-in' };

  // pi 内置 provider 从 JWT claim 取 accountId；Codex 文件里的 account_id 作为兜底
  const accountId = claimAccountId(access) ?? nonEmpty(tokens.account_id);
  if (!accountId) return { status: 'not-logged-in' };

  const expires = jwtExpiresMs(access);
  return { status: 'ok', credential: { type: 'oauth', access, refresh, expires, accountId } };
}

/** Codex 保存时先截断再写（非原子），读到半截内容就稍等重读 */
async function readCodexCredential(file: string): Promise<CodexOauthCredential | null> {
  for (let attempt = 0; ; attempt++) {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return null;
    }
    const parsed = parseCodexAuthJson(raw);
    if (parsed.status === 'ok') return parsed.credential;
    if (parsed.status === 'not-logged-in' || attempt >= 2) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

interface RefreshedTokens {
  access: string;
  refresh: string;
  idToken: string | null;
  expires: number;
}

/** pi 内置刷新会丢掉 id_token，而 Codex 文件必须有它，所以自己发请求 */
async function requestTokenRefresh(
  refreshToken: string,
  signal: AbortSignal
): Promise<RefreshedTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `OpenAI Codex token refresh failed (${response.status}): ${text || response.statusText}`
    );
  }
  const json = obj(await response.json());
  const access = nonEmpty(json.access_token);
  const refresh = nonEmpty(json.refresh_token);
  if (!access || !refresh) throw new Error('OpenAI Codex token refresh response missing tokens');
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 0;
  return {
    access,
    refresh,
    idToken: nonEmpty(json.id_token),
    expires: jwtExpiresMs(access) || Date.now() + expiresIn * 1000,
  };
}

/** 照搬 Codex 的 persist_tokens：读最新文件、只改 tokens 与 last_refresh，再原子替换 */
async function writeCodexTokens(
  file: string,
  accountId: string,
  tokens: RefreshedTokens
): Promise<void> {
  const raw = await readFile(file, 'utf8');
  const current = parseCodexAuthJson(raw);
  if (current.status !== 'ok' || current.credential.accountId !== accountId) return;
  const doc = JSON.parse(raw) as Record<string, unknown>;
  doc.tokens = {
    ...obj(doc.tokens),
    access_token: tokens.access,
    refresh_token: tokens.refresh,
    ...(tokens.idToken ? { id_token: tokens.idToken } : {}),
  };
  doc.last_refresh = new Date().toISOString();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 });
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

interface RefreshableCredential {
  access: string;
  refresh: string;
  expires: number;
  accountId?: unknown;
}

/** 已关联 Codex 的凭证刷新；Codex 未登录、换了账号或文件读不出时退化为独立刷新，不碰它的文件 */
export async function refreshLinkedCodexCredential<T extends RefreshableCredential>(
  current: T,
  signal: AbortSignal,
  codexAuthPath: string
): Promise<T & { codexLinked: true }> {
  const accountId = nonEmpty(current.accountId) ?? claimAccountId(current.access);
  const readLinked = async () => {
    const codex = await readCodexCredential(codexAuthPath);
    return codex && codex.accountId === accountId ? codex : null;
  };
  const usable = (credential: RefreshableCredential) =>
    credential.expires - Date.now() > MIN_VALIDITY_MS;
  const linked = (next: RefreshableCredential) => ({
    ...current,
    access: next.access,
    refresh: next.refresh,
    expires: next.expires,
    codexLinked: true as const,
  });

  const codex = await readLinked();
  // 同一条 token 链上后签发的 access 过期时间一定更晚，据此判断谁手里的更新
  const latest = codex && codex.expires > current.expires ? codex : current;
  if (latest !== current && usable(latest)) return linked(latest);
  let tokens: RefreshedTokens;
  try {
    tokens = await requestTokenRefresh(latest.refresh, signal);
  } catch (error) {
    // 读文件与发请求之间 Codex 抢先轮换了 token：沿用它刚写下的结果
    const raced = await readLinked();
    if (raced && raced.refresh !== latest.refresh && usable(raced)) return linked(raced);
    throw error;
  }
  if (codex && accountId) {
    // 写回失败只会让 Codex 下次刷新报 refresh_token_reused，不能连累本应用已拿到的新 token
    await writeCodexTokens(codexAuthPath, accountId, tokens).catch(() => undefined);
  }
  return linked(tokens);
}

type PiProvider = ReturnType<ModelRuntime['getProviders']>[number];
type PiOAuth = NonNullable<PiProvider['auth']['oauth']>;

const linkedOauth = new WeakSet<object>();

/**
 * 把 runtime 上的 openai-codex 基础 provider 换成刷新时识别 `codexLinked` 的版本。
 *
 * Main 与 worker 各有一份 runtime、都可能触发刷新，两边都要装；账号克隆从基础 provider
 * 复制 auth，所以须在注册克隆之前调用。注销裸 key 会回落到 pi 内置 provider，之后要重装（幂等）。
 */
export function installCodexLinkedRefresh(
  runtime: Pick<ModelRuntime, 'getProvider' | 'registerNativeProvider'>,
  codexAuthPath: () => string = defaultCodexAuthPath
): void {
  const base = runtime.getProvider(CODEX_PROVIDER_ID);
  const oauth = base?.auth.oauth;
  if (!base || !oauth || linkedOauth.has(oauth)) return;
  const wrapped: PiOAuth = {
    ...oauth,
    refresh: (credential, signal) =>
      credential.codexLinked === true
        ? refreshLinkedCodexCredential(credential, signal, codexAuthPath())
        : oauth.refresh(credential, signal),
  };
  linkedOauth.add(wrapped);
  runtime.registerNativeProvider(
    Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
      auth: { ...base.auth, oauth: wrapped },
    })
  );
}
