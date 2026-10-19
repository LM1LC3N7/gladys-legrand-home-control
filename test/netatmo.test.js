import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_KINDS,
  NetatmoClient,
  authorizeUrl,
  classifyApiError,
  classifyTokenError,
  parseRetryAfter,
  requestToken,
} from '../src/netatmo.js';
import { HOME_ID, M, tokenAnswer } from './fixtures/netatmo.js';
import { CLIENT, GOOD_CODE, answer, fakeNetatmo } from './helpers/fakeNetatmo.js';

test('the authorization URL asks for the Home + Control and Bubendorff scopes, space-separated', () => {
  const url = new URL(
    authorizeUrl({
      clientId: 'abc',
      redirectUri: 'https://gladys.example/dashboard/integration/device/external/x/oauth-callback',
      state: 'state-1',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://api.netatmo.com/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'abc');
  assert.equal(
    url.searchParams.get('scope'),
    'read_magellan write_magellan read_bubendorff write_bubendorff',
  );
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.match(url.search, /scope=read_magellan%20write_magellan%20read_bubendorff/, 'no "+"');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://gladys.example/dashboard/integration/device/external/x/oauth-callback',
  );
});

test('API errors are classified like the Netatmo glossary', () => {
  assert.equal(classifyApiError(403, 3), ERROR_KINDS.AUTH);
  assert.equal(classifyApiError(403, 2), ERROR_KINDS.AUTH);
  assert.equal(classifyApiError(401, undefined), ERROR_KINDS.AUTH);
  assert.equal(classifyApiError(403, 13), ERROR_KINDS.SCOPE);
  assert.equal(classifyApiError(403, 26), ERROR_KINDS.THROTTLED);
  assert.equal(classifyApiError(429, 28), ERROR_KINDS.THROTTLED);
  assert.equal(classifyApiError(406, 5), ERROR_KINDS.APP);
  assert.equal(classifyApiError(503, undefined), ERROR_KINDS.SERVER);
  assert.equal(classifyApiError(400, 21), ERROR_KINDS.API);
  assert.equal(classifyTokenError(400, 'invalid_grant'), ERROR_KINDS.GRANT);
  assert.equal(classifyTokenError(400, 'invalid_client'), ERROR_KINDS.GRANT);
  assert.equal(classifyTokenError(400, 'invalid_scope'), ERROR_KINDS.SCOPE);
  assert.equal(classifyTokenError(400, 'redirect_uri_mismatch'), ERROR_KINDS.API);
  assert.equal(parseRetryAfter('120'), 120_000);
  assert.equal(parseRetryAfter('Thu, 15 Oct 2026 10:01:00 GMT', Date.UTC(2026, 9, 15, 10)), 60_000);
  assert.equal(parseRetryAfter(null), undefined);
});

test('the token endpoint: form-encoded request, parsed answer, refusals', async () => {
  const netatmo = fakeNetatmo();
  const tokens = await requestToken(netatmo.fetch, {
    grant_type: 'authorization_code',
    client_id: CLIENT.id,
    client_secret: CLIENT.secret,
    code: GOOD_CODE,
    redirect_uri: 'https://gladys.example/cb',
    scope: 'read_magellan write_magellan',
  });
  assert.deepEqual(tokens, {
    accessToken: tokenAnswer(1).access_token,
    refreshToken: tokenAnswer(1).refresh_token,
    expiresIn: 10800,
    scope: ['read_magellan', 'write_magellan'],
  });
  assert.equal(netatmo.requests[0].body.scope, 'read_magellan write_magellan');

  await assert.rejects(
    requestToken(netatmo.fetch, { grant_type: 'refresh_token', refresh_token: 'old' }),
    (err) => err.kind === ERROR_KINDS.GRANT && /invalid_client/.test(err.message),
  );
  netatmo.offline = true;
  await assert.rejects(
    requestToken(netatmo.fetch, {}),
    (err) => err.kind === ERROR_KINDS.NETWORK && /ENOTFOUND/.test(err.message),
  );
});

function client(netatmo, overrides = {}) {
  const calls = { refresh: 0, paused: [] };
  const tokens = {
    current: tokenAnswer(1).access_token,
    accessToken: async () => tokens.current,
    refresh: async (refused) => {
      calls.refresh += 1;
      assert.equal(refused, tokens.current);
      netatmo.seed(2);
      tokens.current = tokenAnswer(2).access_token;
    },
  };
  const limiter = {
    acquire: async () => {},
    now: () => 1000,
    pause: (until) => calls.paused.push(until),
  };
  return {
    calls,
    api: new NetatmoClient({ fetch: netatmo.fetch, tokens, limiter, ...overrides }),
  };
}

test('homesdata, homestatus and setstate requests', async () => {
  const netatmo = fakeNetatmo();
  netatmo.seed(1);
  const { api } = client(netatmo);
  const homes = await api.homesData();
  assert.equal(homes.length, 2);
  const { home, errors } = await api.homeStatus(HOME_ID);
  assert.equal(home.id, HOME_ID);
  assert.deepEqual(errors, []);
  const status = netatmo.requests.find((r) => r.path === '/api/homestatus');
  assert.deepEqual(status.query, { home_id: HOME_ID });
  assert.equal(status.headers.Authorization, `Bearer ${tokenAnswer(1).access_token}`);

  assert.deepEqual(await api.setState(HOME_ID, [{ id: M.OUTLET, on: false }]), []);
  const set = netatmo.requests.find((r) => r.path === '/api/setstate');
  assert.equal(set.method, 'POST');
  assert.deepEqual(set.body, { home: { id: HOME_ID, modules: [{ id: M.OUTLET, on: false }] } });
  assert.equal(netatmo.module(M.OUTLET).on, false);

  netatmo.setstateErrors.push({ id: M.OUTLET, code: 6 });
  assert.deepEqual(await api.setState(HOME_ID, [{ id: M.OUTLET, on: true }]), [
    { id: M.OUTLET, code: 6 },
  ]);
});

test('an expired access token is refreshed once and the request replayed', async () => {
  const netatmo = fakeNetatmo();
  netatmo.seed(1);
  const { api, calls } = client(netatmo);
  netatmo.expireAccess();
  assert.equal((await api.homesData()).length, 2);
  assert.equal(calls.refresh, 1);
  assert.equal(netatmo.count('/api/homesdata'), 2);

  // Still refused after the refresh: no loop.
  const refused = answer(403, { error: { code: 2, message: 'Invalid access token' } });
  netatmo.once(() => true, refused);
  netatmo.once(() => true, refused);
  await assert.rejects(api.homesData(), (err) => err.kind === ERROR_KINDS.AUTH);
  assert.equal(calls.refresh, 2);
});

test('a usage limit pauses the limiter for the Retry-After delay', async () => {
  const netatmo = fakeNetatmo();
  netatmo.seed(1);
  const { api, calls } = client(netatmo);
  netatmo.once(
    () => true,
    answer(429, { error: { code: 26, message: 'User usage reached' } }, { 'Retry-After': '90' }),
  );
  await assert.rejects(
    api.homesData(),
    (err) => err.kind === ERROR_KINDS.THROTTLED && err.retryAfter === 90_000,
  );
  assert.deepEqual(calls.paused, [1000 + 90_000]);
  netatmo.once(() => true, answer(200, 'not json'));
  await assert.rejects(api.homesData(), (err) => err.kind === ERROR_KINDS.SERVER);
});

test('a setstate error says whether the request may have reached Netatmo', async () => {
  const netatmo = fakeNetatmo();
  netatmo.seed(1);
  const { api } = client(netatmo);
  const entry = [{ id: M.SHUTTER, target_position: 100 }];
  netatmo.once(() => true, answer(503, { error: { code: 1, message: 'Unavailable' } }));
  await assert.rejects(api.setState(HOME_ID, entry), (err) => err.unconfirmed === true);
  netatmo.once(() => true, answer(200, 'not json'));
  await assert.rejects(api.setState(HOME_ID, entry), (err) => err.unconfirmed === true);
  netatmo.once(
    () => true,
    () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    },
  );
  await assert.rejects(api.setState(HOME_ID, entry), (err) => err.unconfirmed === true);
  netatmo.once(() => true, answer(429, { error: { code: 26, message: 'User usage reached' } }));
  await assert.rejects(api.setState(HOME_ID, entry), (err) => err.unconfirmed === false);
  netatmo.offline = true;
  await assert.rejects(api.setState(HOME_ID, entry), (err) => err.unconfirmed === false);
  netatmo.offline = false;

  // Every command withdrawn before the request left: nothing is sent.
  const before = netatmo.count('/api/setstate');
  let sent = 0;
  assert.equal(await api.setState(HOME_ID, () => [], { onSend: () => (sent += 1) }), null);
  assert.equal(netatmo.count('/api/setstate'), before);
  assert.equal(sent, 0);
});
