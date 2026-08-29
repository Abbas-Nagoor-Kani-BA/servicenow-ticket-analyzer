import { MSG } from "../../lib/keys.ts";

export type FetchResult = {
  ok: boolean;
  status?: number;
  text?: string;
  headers?: Record<string, string>;
  via?: string;
  hadToken?: boolean;
  tokenSource?: string | null;
  error?: string;
};

export type Transport = (url: string, opts?: { attempt?: number }) => Promise<FetchResult>;

const TOKEN_TTL_MS = 8 * 60 * 1000;
const MAX_AUTH_RETRIES = 2;

/**
 * Session-authenticated transport for ServiceNow.
 *
 * The order is load-bearing and was arrived at the hard way (see the auth chain
 * in AGENTS.md):
 *
 * 1. an open tab on the instance origin — without one, session auth is
 *    impossible, so fail fast with a message that says so
 * 2. CSRF token from the `g_ck` cookie, else a MAIN-world injection reading the
 *    page global (content scripts run in an isolated world and cannot see it)
 * 3. relay the request through that tab's content script, so cookies are
 *    first-party and not blocked as third-party
 * 4. a direct fetch from the worker as a last resort
 */
export function createSmartTransport(): Transport {
  let tokenCache: { value: string; source: string | null; at: number } | null = null;

  const resolveToken = async (
    origin: string,
    tab: any,
    forceFresh: boolean
  ): Promise<{ value: string | null; source: string | null }> => {
    if (!forceFresh && tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) {
      return { value: tokenCache.value, source: tokenCache.source };
    }
    let token = await getCookieToken(origin);
    let source: string | null = token ? "cookie" : null;
    if (!token && tab?.id !== undefined) {
      token = await getPageToken(tab.id);
      source = token ? "page-injection" : null;
    }
    if (token) tokenCache = { value: token, source, at: Date.now() };
    return { value: token, source };
  };

  const transport: Transport = async (url, opts = {}) => {
    const attempt = opts.attempt || 0;
    const origin = new URL(url).origin;
    const tab = await findServiceNowTab(origin);
    if (!tab) {
      return {
        ok: false,
        error: `No open tab found for ${origin}. Open your ServiceNow instance in a browser tab, log in, and keep it open while using the analyzer.`
      };
    }

    const { value: token, source } = await resolveToken(origin, tab, attempt > 0);

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: MSG.snFetch, url, token });
      if (resp && resp.ok) {
        if (resp.status === 401 && attempt < MAX_AUTH_RETRIES) {
          tokenCache = null;
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          return transport(url, { ...opts, attempt: attempt + 1 });
        }
        return {
          ok: true,
          status: resp.status,
          text: resp.text,
          headers: resp.headers,
          via: "relay",
          hadToken: Boolean(resp.tokenFound),
          tokenSource: source
        };
      }
    } catch {
      /* fall through to the direct attempt */
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers["X-UserToken"] = token;

    try {
      const res = await fetch(url, { method: "GET", credentials: "include", headers });
      const text = await res.text();
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });
      if (res.status === 401 && token && attempt < MAX_AUTH_RETRIES) {
        tokenCache = null;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        return transport(url, { ...opts, attempt: attempt + 1 });
      }
      return {
        ok: true,
        status: res.status,
        text,
        headers: responseHeaders,
        via: "direct",
        hadToken: Boolean(token),
        tokenSource: source
      };
    } catch (err) {
      return { ok: false, error: String(err), via: "direct", hadToken: Boolean(token) };
    }
  };

  return transport;
}

async function findServiceNowTab(origin: string): Promise<any | null> {
  try {
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    return tabs.sort((a: any, b: any) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
  } catch {
    return null;
  }
}

function getCookieToken(origin: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.cookies.get({ url: origin, name: "g_ck" }, (c: any) => resolve(c?.value || null));
    } catch {
      resolve(null);
    }
  });
}

async function getPageToken(tabId: number): Promise<string | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          return typeof window.g_ck === "string" && window.g_ck ? window.g_ck : null;
        } catch {
          return null;
        }
      }
    });
    return results?.[0]?.result || null;
  } catch {
    return null;
  }
}
