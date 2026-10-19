// -----------------------------------------------------------------------------
// The only network access: the Netatmo Connect API, its OAuth2 token endpoint
// and the Home + Control endpoints (homesdata, homestatus, setstate). Every API
// request waits for a slot of the request limiter and carries a valid access
// token; a token refused by Netatmo is refreshed once and the request replayed.
// -----------------------------------------------------------------------------

import { NETATMO, SCOPES, TIMINGS } from './constants.js';
import { PRIORITY } from './limiter.js';

export const ERROR_KINDS = {
  /** The access token is invalid or expired: refresh it, then replay. */
  AUTH: 'auth',
  /** The refresh token or the app credentials are refused: connect again. */
  GRANT: 'grant',
  /** The authorization lacks the Home + Control rights. */
  SCOPE: 'scope',
  /** A Netatmo usage limit is reached: pause. */
  THROTTLED: 'throttled',
  /** The Netatmo app was deactivated by its developer. */
  APP: 'app',
  /** Netatmo is unreachable (network, DNS, timeout). */
  NETWORK: 'network',
  /** Netatmo failed (5xx, answer that is not JSON). */
  SERVER: 'server',
  API: 'api',
};

export class NetatmoError extends Error {
  constructor(message, { kind = ERROR_KINDS.API, status, code, retryAfter, unconfirmed } = {}) {
    super(message);
    this.name = 'NetatmoError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    /**
     * True when the request may have reached Netatmo and been applied
     * (timeout, connection cut, 5xx, answer that is not JSON): a command is
     * then "sent, without confirmation", never "not sent".
     */
    this.unconfirmed = unconfirmed === true;
  }
}

/** Network failures that prove the request never left (name resolution, refused connection). */
const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The kind of an API error answer (HTTP status + `error.code`, see the Netatmo glossary). */
export function classifyApiError(status, code) {
  if (status === 429 || code === 26 || code === 28 || code === 29) {
    return ERROR_KINDS.THROTTLED;
  }
  if (status === 401 || (status === 403 && [-2, -1, 1, 2, 3].includes(code))) {
    return ERROR_KINDS.AUTH;
  }
  if (code === 13) {
    return ERROR_KINDS.SCOPE;
  }
  if (code === 5) {
    return ERROR_KINDS.APP;
  }
  if (status >= 500) {
    return ERROR_KINDS.SERVER;
  }
  return ERROR_KINDS.API;
}

/** The kind of an OAuth2 token endpoint error (`{ error: 'invalid_grant' }`). */
export function classifyTokenError(status, error) {
  if (['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied'].includes(error)) {
    return ERROR_KINDS.GRANT;
  }
  if (error === 'invalid_scope') {
    return ERROR_KINDS.SCOPE;
  }
  if (status === 429) {
    return ERROR_KINDS.THROTTLED;
  }
  if (status >= 500) {
    return ERROR_KINDS.SERVER;
  }
  return ERROR_KINDS.API;
}

/** Retry-After (seconds or HTTP date) in milliseconds, or undefined. */
export function parseRetryAfter(header, now = Date.now()) {
  if (header === null || header === undefined || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

const reasonOf = (err) =>
  err?.name === 'TimeoutError' || err?.name === 'AbortError'
    ? 'timeout'
    : (err?.cause?.code ?? err?.code ?? err?.message ?? 'network error');

async function readJson(response) {
  const text = await response.text();
  if (text === '') {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The authorization page the "Connect" button opens. Scopes are space-separated. */
export function authorizeUrl({ clientId, redirectUri, state, scopes = SCOPES }) {
  const query = [
    ['client_id', clientId],
    ['redirect_uri', redirectUri],
    ['scope', scopes.join(' ')],
    ['state', state],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${NETATMO.authorizeUrl}?${query}`;
}

const parseScope = (scope) =>
  Array.isArray(scope)
    ? scope.map(String)
    : typeof scope === 'string'
      ? scope.split(/[\s,]+/).filter(Boolean)
      : [];

/**
 * One call of the token endpoint (authorization code or refresh token grant).
 * @returns {Promise<{ accessToken, refreshToken, expiresIn, scope }>}
 */
export async function requestToken(fetchFn, form, { timeout = TIMINGS.requestTimeout } = {}) {
  let response;
  try {
    response = await fetchFn(NETATMO.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw new NetatmoError(`Netatmo is unreachable (${reasonOf(err)})`, {
      kind: ERROR_KINDS.NETWORK,
    });
  }
  const data = await readJson(response);
  if (!response.ok || typeof data?.access_token !== 'string') {
    const error = typeof data?.error === 'string' ? data.error : undefined;
    const detail = data?.error_description ?? data?.error?.message ?? error ?? response.statusText;
    throw new NetatmoError(`Netatmo refused the authorization (${response.status}): ${detail}`, {
      kind: classifyTokenError(response.status, error),
      status: response.status,
      code: error,
    });
  }
  const expiresIn = Number(data.expires_in ?? data.expire_in);
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 10_800,
    scope: parseScope(data.scope),
  };
}

export class NetatmoClient {
  /**
   * @param {object} deps
   * @param {Function} deps.fetch - WHATWG fetch.
   * @param {object} deps.tokens - `accessToken()` and `refresh(refusedToken)`.
   * @param {object} deps.limiter - The RequestLimiter.
   */
  constructor({ fetch: fetchFn, tokens, limiter, timeout = TIMINGS.requestTimeout }) {
    this.fetch = fetchFn;
    this.tokens = tokens;
    this.limiter = limiter;
    this.timeout = timeout;
  }

  /** The homes of the account, with their rooms and modules. */
  async homesData() {
    const data = await this.call('GET', 'homesdata');
    return Array.isArray(data?.body?.homes) ? data.body.homes : [];
  }

  /** The current state of the modules of one home: `{ home, errors }`. */
  async homeStatus(homeId, priority = PRIORITY.BACKGROUND) {
    const data = await this.call('GET', 'homestatus', { query: { home_id: homeId }, priority });
    return {
      home: data?.body?.home ?? { id: homeId, modules: [] },
      errors: Array.isArray(data?.body?.errors) ? data.body.errors : [],
    };
  }

  /**
   * Changes the state of modules of one home; resolves the per-module `errors`.
   * `modules` may be a function called at the last moment, once the request
   * budget and the token are there: an empty list then sends nothing (every
   * command was withdrawn) and resolves null. `onSend` is called right before
   * the request leaves; `onRetry` when Netatmo refused it for its access token
   * (nothing applied) and it waits for the refresh before being replayed: the
   * replay reads the list again.
   */
  async setState(homeId, modules, { onSend, onRetry } = {}) {
    const data = await this.call('POST', 'setstate', {
      json: () => {
        const list = typeof modules === 'function' ? modules() : modules;
        return list.length > 0 ? { home: { id: homeId, modules: list } } : null;
      },
      priority: PRIORITY.COMMAND,
      onSend,
      onRetry,
    });
    if (data === null) {
      return null;
    }
    return Array.isArray(data?.body?.errors) ? data.body.errors : [];
  }

  async call(
    method,
    endpoint,
    { query, json, priority = PRIORITY.BACKGROUND, onSend, onRetry } = {},
  ) {
    for (let attempt = 0; ; attempt += 1) {
      await this.limiter.acquire(priority);
      const token = await this.tokens.accessToken();
      const body = typeof json === 'function' ? json() : json;
      if (body === null) {
        return null;
      }
      try {
        onSend?.();
        return await this.send(method, endpoint, { query, json: body, token });
      } catch (err) {
        if (err.kind === ERROR_KINDS.AUTH && attempt === 0) {
          // Refused for its token: nothing was applied, the request is back to unsent.
          onRetry?.();
          await this.tokens.refresh(token);
          continue;
        }
        if (err.kind === ERROR_KINDS.THROTTLED) {
          this.limiter.pause(this.limiter.now() + (err.retryAfter ?? TIMINGS.throttlePause));
        }
        throw err;
      }
    }
  }

  async send(method, endpoint, { query, json, token }) {
    const params = new URLSearchParams(query ?? {}).toString();
    const url = `${NETATMO.apiUrl}/${endpoint}${params ? `?${params}` : ''}`;
    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(json ? { 'Content-Type': 'application/json;charset=utf-8' } : {}),
        },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const reason = reasonOf(err);
      throw new NetatmoError(`Netatmo is unreachable (${reason})`, {
        kind: ERROR_KINDS.NETWORK,
        unconfirmed: !NOT_SENT_CODES.has(reason),
      });
    }
    let data;
    try {
      data = await readJson(response);
    } catch (err) {
      // The answer was cut while it was read: the request did reach Netatmo.
      throw new NetatmoError(`Netatmo answer to ${endpoint} cut (${reasonOf(err)})`, {
        kind: ERROR_KINDS.NETWORK,
        unconfirmed: true,
      });
    }
    if (!response.ok) {
      const code = typeof data?.error?.code === 'number' ? data.error.code : undefined;
      const message = data?.error?.message ?? data?.error ?? response.statusText;
      throw new NetatmoError(
        `Netatmo answered ${response.status}${code !== undefined ? ` (code ${code})` : ''} to ${endpoint}: ${message}`,
        {
          kind: classifyApiError(response.status, code),
          status: response.status,
          code,
          retryAfter: parseRetryAfter(response.headers?.get?.('retry-after')),
          unconfirmed: response.status >= 500,
        },
      );
    }
    if (data === undefined) {
      throw new NetatmoError(`Netatmo answered ${endpoint} with a body that is not JSON`, {
        kind: ERROR_KINDS.SERVER,
        status: response.status,
        unconfirmed: true,
      });
    }
    return data;
  }
}
