import { describe, expect, it } from 'vitest';
import { parseCodexAuthJson } from './codexAuthImport';

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`;
}

const exp = Math.floor(Date.now() / 1000) + 3600;
const access = fakeJwt({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } });

const codexAuth = (tokens: Record<string, unknown> | undefined, extra?: Record<string, unknown>) =>
  JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens, ...extra });

describe('parseCodexAuthJson', () => {
  it('把 Codex tokens 映射成 pi 的 openai-codex 凭证，expires 取自 access JWT 的 exp', () => {
    const parsed = parseCodexAuthJson(
      codexAuth({ id_token: 'id', access_token: access, refresh_token: 'rt', account_id: 'acct_1' })
    );
    expect(parsed).toEqual({
      status: 'ok',
      credential: {
        type: 'oauth',
        access,
        refresh: 'rt',
        expires: exp * 1000,
        accountId: 'acct_1',
      },
    });
  });

  it('JWT 里没有 chatgpt_account_id 时回退到 tokens.account_id', () => {
    const bare = fakeJwt({ exp });
    const parsed = parseCodexAuthJson(
      codexAuth({ access_token: bare, refresh_token: 'rt', account_id: 'acct_2' })
    );
    expect(parsed.status === 'ok' && parsed.credential.accountId).toBe('acct_2');
  });

  it('JWT 缺 exp 时 expires 为 0，交给 pi 立即刷新', () => {
    const noExp = fakeJwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } });
    const parsed = parseCodexAuthJson(
      codexAuth({ access_token: noExp, refresh_token: 'rt', account_id: 'acct_1' })
    );
    expect(parsed.status === 'ok' && parsed.credential.expires).toBe(0);
  });

  it.each([
    ['tokens 缺失（API key 模式）', codexAuth(undefined, { OPENAI_API_KEY: 'sk-x' })],
    ['tokens 为 null', JSON.stringify({ tokens: null })],
    ['refresh_token 为空', codexAuth({ access_token: access, refresh_token: '', account_id: 'a' })],
    ['access_token 缺失', codexAuth({ refresh_token: 'rt', account_id: 'a' })],
  ])('%s → not-logged-in', (_label, raw) => {
    expect(parseCodexAuthJson(raw)).toEqual({ status: 'not-logged-in' });
  });

  it('access 与 tokens 都给不出 accountId 时视为未登录', () => {
    const parsed = parseCodexAuthJson(
      codexAuth({ access_token: fakeJwt({ exp }), refresh_token: 'rt', account_id: '' })
    );
    expect(parsed).toEqual({ status: 'not-logged-in' });
  });

  it.each([
    ['非 JSON', '{not json'],
    ['数组', '[]'],
    ['字符串', '"x"'],
  ])('%s → invalid', (_label, raw) => {
    expect(parseCodexAuthJson(raw)).toEqual({ status: 'invalid' });
  });
});
