// -----------------------------------------------------------------------------
// A fake Netatmo Connect, behind a `fetch` function: the token endpoint (codes,
// rotating refresh tokens), homesdata, homestatus and setstate, with the
// error answers of the glossary. No network.
// -----------------------------------------------------------------------------

import {
  BUBENDORFF_MODULES,
  BUBENDORFF_STATUSES,
  HOMESDATA,
  HOMESTATUS,
  HOME_ID,
  tokenAnswer,
} from '../fixtures/netatmo.js';

const clone = (v) => structuredClone(v);

/** A minimal WHATWG Response. */
export function answer(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => text,
  };
}

export const GOOD_CODE = 'good-code';
export const CLIENT = { id: 'my-client-id', secret: 'my-client-secret' };

export function fakeNetatmo() {
  const api = {
    requests: [],
    homesdata: clone(HOMESDATA),
    statuses: new Map([[HOME_ID, clone(HOMESTATUS)]]),
    /** The number of the current token pair (0: none issued yet). */
    issued: 0,
    validAccess: undefined,
    validRefresh: undefined,
    /** One-shot answers: [{ match(req) -> bool, answer }] */
    scripted: [],
    /** Per-module errors of the next setstate answers. */
    setstateErrors: [],
    /** When true, every request fails at the network level. */
    offline: false,
    /** API requests refused for their access token. */
    refused: 0,
    /** The rights the Netatmo app offers (undefined: all); others answer invalid_scope. */
    appScopes: undefined,
    /** The scope the token answers carry (undefined: the fixture's). */
    grantedScope: undefined,

    /** Adds a Bubendorff iDiamant gateway and its shutters to the home. */
    bubendorff() {
      api.homesdata.body.homes[0].modules.push(...clone(BUBENDORFF_MODULES));
      api.status().body.home.modules.push(...clone(BUBENDORFF_STATUSES));
    },

    /** Gives the fake the tokens an earlier connection obtained. */
    seed(n = 1) {
      api.issued = n;
      api.validAccess = tokenAnswer(n).access_token;
      api.validRefresh = tokenAnswer(n).refresh_token;
    },
    /** The access token expires on the Netatmo side. */
    expireAccess() {
      api.validAccess = 'expired-for-everyone';
    },
    once(match, response) {
      api.scripted.push({ match, response });
    },
    count(path) {
      return api.requests.filter((r) => r.path === path).length;
    },
    status(homeId = HOME_ID) {
      return api.statuses.get(homeId);
    },
    module(id, homeId = HOME_ID) {
      return api.status(homeId).body.home.modules.find((m) => m.id === id);
    },

    issue() {
      api.issued += 1;
      const tokens = { ...tokenAnswer(api.issued) };
      if (api.grantedScope) {
        tokens.scope = api.grantedScope;
      }
      api.validAccess = tokens.access_token;
      api.validRefresh = tokens.refresh_token;
      return answer(200, tokens);
    },

    fetch: async (url, init = {}) => {
      const u = new URL(url);
      const request = {
        method: init.method ?? 'GET',
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        headers: init.headers ?? {},
        body:
          typeof init.body === 'string' && init.body.startsWith('{')
            ? JSON.parse(init.body)
            : Object.fromEntries(new URLSearchParams(init.body ?? '')),
      };
      api.requests.push(request);
      if (api.offline) {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ENOTFOUND' };
        throw err;
      }
      const scripted = api.scripted.findIndex((s) => s.match(request));
      if (scripted !== -1) {
        const [{ response }] = api.scripted.splice(scripted, 1);
        return typeof response === 'function' ? response(request) : response;
      }
      if (request.path === '/oauth2/token') {
        return api.token(request.body);
      }
      if (request.headers.Authorization !== `Bearer ${api.validAccess}`) {
        api.refused += 1;
        return answer(403, { error: { code: 3, message: 'Access token expired' } });
      }
      switch (`${request.method} ${request.path}`) {
        case 'GET /api/homesdata':
          return answer(200, api.homesdata);
        case 'GET /api/homestatus': {
          const status = api.statuses.get(request.query.home_id);
          return status
            ? answer(200, status)
            : answer(400, { error: { code: 21, message: 'Invalid argument' } });
        }
        case 'POST /api/setstate':
          return api.setstate(request.body);
        default:
          return answer(404, { error: { code: 31, message: 'Method not found' } });
      }
    },

    token(form) {
      if (form.client_id !== CLIENT.id || form.client_secret !== CLIENT.secret) {
        return answer(400, { error: 'invalid_client' });
      }
      if (form.grant_type === 'authorization_code') {
        const asked = String(form.scope ?? '')
          .split(' ')
          .filter(Boolean);
        if (api.appScopes && asked.some((s) => !api.appScopes.includes(s))) {
          return answer(400, { error: 'invalid_scope' });
        }
        return form.code === GOOD_CODE ? api.issue() : answer(400, { error: 'invalid_grant' });
      }
      if (form.grant_type === 'refresh_token') {
        // Rotation: only the last refresh token works, once.
        return form.refresh_token === api.validRefresh
          ? api.issue()
          : answer(400, { error: 'invalid_grant' });
      }
      return answer(400, { error: 'unsupported_grant_type' });
    },

    setstate(body) {
      const home = api.statuses.get(body?.home?.id);
      if (!home) {
        return answer(400, { error: { code: 21, message: 'Invalid argument' } });
      }
      const errors = api.setstateErrors.splice(0);
      for (const entry of body.home.modules ?? []) {
        if (errors.some((e) => e.id === entry.id)) {
          continue;
        }
        const module = home.body.home.modules.find((m) => m.id === entry.id);
        const { id: _id, bridge: _bridge, ...fields } = entry;
        if (module) {
          Object.assign(module, fields);
          if (fields.target_position !== undefined && fields.target_position >= 0) {
            module.current_position = fields.target_position;
          }
        }
      }
      return answer(
        200,
        errors.length > 0
          ? { status: 'ok', time_server: 1760000000, body: { errors } }
          : { status: 'ok', time_server: 1760000000 },
      );
    },
  };
  return api;
}

/** Lets the pending promise callbacks run (the fake answers asynchronously). */
export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
