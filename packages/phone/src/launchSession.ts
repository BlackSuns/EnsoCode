/** 通知冷启动：iOS PWA 常忽略 openWindow 的 query，SW 先把 sessionId 写入 Cache。 */

export const LAUNCH_SESSION_CACHE = 'enso-phone-launch';
export const LAUNCH_SESSION_URL = '/__open-session';

const SESSION_ID_MAX = 200;
const SESSION_ID_RE = /^[\w.:-]+$/;

export function parseSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > SESSION_ID_MAX) return null;
  if (!SESSION_ID_RE.test(id)) return null;
  return id;
}

export function parseSessionFromSearch(search: string): string | null {
  if (typeof search !== 'string' || !search) return null;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return parseSessionId(new URLSearchParams(query).get('session'));
}

type LaunchCache = {
  match(url: RequestInfo): Promise<Response | undefined>;
  delete(url: RequestInfo): Promise<boolean>;
};

export type LaunchCaches = {
  open(name: string): Promise<LaunchCache>;
};

export async function takeStashedSessionId(
  cachesApi: LaunchCaches | undefined = typeof caches === 'undefined' ? undefined : caches
): Promise<string | null> {
  if (!cachesApi) return null;
  try {
    const cache = await cachesApi.open(LAUNCH_SESSION_CACHE);
    const res = await cache.match(LAUNCH_SESSION_URL);
    await cache.delete(LAUNCH_SESSION_URL);
    if (!res) return null;
    return parseSessionId(await res.text());
  } catch {
    return null;
  }
}
