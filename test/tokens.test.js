import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TIMINGS } from '../src/constants.js';
import { ERROR_KINDS } from '../src/netatmo.js';
import { TokenManager, storedTokens } from '../src/tokens.js';
import { tokenAnswer } from './fixtures/netatmo.js';
import { CLIENT, GOOD_CODE, fakeNetatmo } from './helpers/fakeNetatmo.js';

const APP = { clientId: CLIENT.id, clientSecret: CLIENT.secret };

function setup(config = {}) {
  const netatmo = fakeNetatmo();
  const gladys = createFakeGladys({ config });
  let t = 1_760_000_000_000;
  const tokens = new TokenManager({ gladys, fetch: netatmo.fetch, now: () => t });
  tokens.load(config, APP);
  return { netatmo, gladys, tokens, advance: (ms) => (t += ms), now: () => t };
}

const tokenRequests = (netatmo) => netatmo.requests.filter((r) => r.path === '/oauth2/token');

test('the code exchange stores the tokens off-schema', async () => {
  const { gladys, tokens, now } = setup();
  assert.equal(tokens.connected, false);
  await tokens.exchange(GOOD_CODE, 'https://gladys.example/cb');
  assert.equal(tokens.connected, true);
  assert.equal(tokens.hasAllScopes, true);
  assert.deepEqual(gladys.fake.config, {
    access_token: tokenAnswer(1).access_token,
    refresh_token: tokenAnswer(1).refresh_token,
    token_expires_at: now() + 10_800_000,
    token_client_id: CLIENT.id,
    token_scope: 'read_magellan write_magellan',
  });
  assert.equal(await tokens.accessToken(), tokenAnswer(1).access_token);
});

test('a refused code leaves the account unlinked', async () => {
  const { tokens } = setup();
  await assert.rejects(
    tokens.exchange('stale-code', 'https://gladys.example/cb'),
    (err) => err.kind === ERROR_KINDS.GRANT,
  );
  assert.equal(tokens.connected, false);
});

test('the token is refreshed before it expires, and the rotated tokens are saved', async () => {
  const { gladys, netatmo, tokens, advance } = setup();
  await tokens.exchange(GOOD_CODE, 'https://gladys.example/cb');
  advance(10_800_000 - TIMINGS.refreshMargin - 1);
  assert.equal(await tokens.accessToken(), tokenAnswer(1).access_token, 'not yet');
  advance(1);
  const [a, b] = await Promise.all([tokens.accessToken(), tokens.accessToken()]);
  assert.equal(a, tokenAnswer(2).access_token);
  assert.equal(b, tokenAnswer(2).access_token);
  assert.equal(tokenRequests(netatmo).length, 2, 'one refresh for both callers');
  assert.equal(tokenRequests(netatmo)[1].body.refresh_token, tokenAnswer(1).refresh_token);
  assert.equal(gladys.fake.config.refresh_token, tokenAnswer(2).refresh_token);

  // A refusal of a token already replaced does not refresh again.
  await tokens.refresh(tokenAnswer(1).access_token);
  assert.equal(tokenRequests(netatmo).length, 2);
});

test('a refused refresh token stops the requests until the app or the account changes', async () => {
  const { netatmo, tokens } = setup();
  await tokens.exchange(GOOD_CODE, 'https://gladys.example/cb');
  netatmo.validRefresh = 'revoked-in-the-netatmo-account';
  await assert.rejects(tokens.refresh(), (err) => err.kind === ERROR_KINDS.GRANT);
  const before = netatmo.requests.length;
  await assert.rejects(tokens.accessToken(), (err) => err.kind === ERROR_KINDS.GRANT);
  assert.equal(netatmo.requests.length, before, 'no request with a refused refresh token');

  // The user fixes the client secret: the refresh token is tried again.
  tokens.load({}, { ...APP, clientSecret: 'typo-fixed' });
  assert.equal(tokens.refused, undefined);
  // The user connects again: a new pair.
  tokens.load({}, APP);
  await tokens.exchange(GOOD_CODE, 'https://gladys.example/cb');
  assert.ok(await tokens.accessToken());
});

test('the tokens in memory win over the stored ones; another app forgets them', async () => {
  const stored = {
    access_token: 'stored-access',
    refresh_token: 'stored-refresh',
    token_expires_at: 1_760_000_000_000 + 3_600_000,
    token_client_id: CLIENT.id,
    token_scope: 'read_magellan',
  };
  const { tokens } = setup(stored);
  assert.equal(tokens.state.refreshToken, 'stored-refresh');
  assert.equal(tokens.hasAllScopes, false, 'write_magellan is missing');
  tokens.state.refreshToken = 'newer-in-memory';
  assert.equal(tokens.load(stored, APP), false);
  assert.equal(tokens.state.refreshToken, 'newer-in-memory');

  assert.equal(tokens.load(stored, { ...APP, clientId: 'another-app' }), true);
  assert.equal(tokens.connected, false);
  assert.equal(storedTokens({ refresh_token: '' }), null);
});

test('a failed save keeps the tokens in memory and is retried', async (t) => {
  const { gladys, tokens } = setup();
  t.mock.method(gladys, 'setConfig', async () => {
    throw new Error('Gladys is restarting');
  });
  await tokens.exchange(GOOD_CODE, 'https://gladys.example/cb');
  assert.equal(tokens.unsaved, true);
  assert.equal(tokens.connected, true);
  t.mock.restoreAll();
  await tokens.flush();
  assert.equal(tokens.unsaved, false);
  assert.equal(gladys.fake.config.refresh_token, tokenAnswer(1).refresh_token);
});
