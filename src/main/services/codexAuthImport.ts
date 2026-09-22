/**
 * 把 Codex Desktop / CLI 的 `~/.codex/auth.json` 解析成 pi 的 openai-codex OAuth 凭证。
 *
 * 两边用的是同一个 OAuth client，token 可直接互用；差别只在文件形状：
 * Codex 存 `tokens.{access_token, refresh_token, account_id}` 且不记过期时间，
 * pi 需要 `{access, refresh, expires, accountId}`，expires 从 access JWT 的 `exp` 解出。
 * 只读不写 Codex 的文件；导入后两边各自持有并刷新自己的凭证。
 */

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

  const claims = decodeJwtPayload(access);
  // pi 内置 provider 从 JWT claim 取 accountId；Codex 文件里的 account_id 作为兜底
  const accountId =
    nonEmpty(obj(claims[OPENAI_AUTH_CLAIM]).chatgpt_account_id) ?? nonEmpty(tokens.account_id);
  if (!accountId) return { status: 'not-logged-in' };

  const exp = claims.exp;
  const expires = typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  return { status: 'ok', credential: { type: 'oauth', access, refresh, expires, accountId } };
}
