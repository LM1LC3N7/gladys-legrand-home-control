// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake Netatmo Connect. Timers are mocked: the polls, the
// request spacing and the command batching run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LegrandApp } from '../src/app.js';
import { ACTIONS, OAUTH_FIELD, TIMINGS } from '../src/constants.js';
import { platformId } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { HOME_ID, M, tokenAnswer } from './fixtures/netatmo.js';
import { CLIENT, GOOD_CODE, answer, fakeNetatmo, settle } from './helpers/fakeNetatmo.js';

const NOW = 1_760_000_000_000;
const REDIRECT =
  'https://gladys.example/dashboard/integration/device/external/test-integration/oauth-callback';
const APP_CONFIG = { client_id: CLIENT.id, client_secret: CLIENT.secret, poll_interval: 60 };
const LINKED = {
  ...APP_CONFIG,
  access_token: tokenAnswer(1).access_token,
  refresh_token: tokenAnswer(1).refresh_token,
  token_expires_at: NOW + 3 * 3_600_000,
  token_client_id: CLIENT.id,
  token_scope: 'read_magellan write_magellan',
};

const dev = (moduleId) => `ext:test-integration:module:${platformId(moduleId)}`;
const feat = (moduleId, key) => `${dev(moduleId)}:${key}`;

async function setup(t, { config = LINKED } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const netatmo = fakeNetatmo();
  if (config.refresh_token) {
    netatmo.seed(1);
  }
  const gladys = createFakeGladys({ config });
  let n = 0;
  const app = new LegrandApp({
    gladys,
    fetch: netatmo.fetch,
    now: () => Date.now(),
    randomId: () => `state-${(n += 1)}`,
    logger: createLogger({ level: 'silent' }),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  /** Lets `ms` of time pass, one second at a time. */
  const run = async (ms) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      await tick(Math.min(1000, ms - elapsed));
    }
  };
  return { gladys, app, netatmo, tick, run };
}

/** The first read of the account: homesdata, then homestatus 5 s later (request spacing). */
const firstRead = (ctx) => ctx.run(6000);

async function create(ctx, ...moduleIds) {
  for (const id of moduleIds) {
    const device = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === dev(id));
    await ctx.gladys.fake.deviceCreated(device);
  }
  await settle();
}

const deviceOf = (ctx, id) => ctx.gladys.fake.devices.find((d) => d.external_id === dev(id));
const featureOf = (ctx, id, key) =>
  deviceOf(ctx, id).features.find((f) => f.external_id === feat(id, key));

/** Sends a command like Gladys, lets the batch go, resolves its ack. */
async function command(ctx, id, key, value) {
  const ack = ctx.gladys.fake.setValue(deviceOf(ctx, id), featureOf(ctx, id, key), value);
  await ctx.tick(TIMINGS.commandBatch);
  return ack;
}

test('Connect: the authorization URL, the state check, the tokens stored off-schema', async (t) => {
  const ctx = await setup(t, { config: APP_CONFIG });
  const { gladys, netatmo } = ctx;
  assert.match(gladys.fake.connectionStatus.message.en, /Click Connect/);

  const first = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT);
  assert.equal(first.success, true);
  const url = new URL(first.data.authorize_url);
  assert.equal(url.searchParams.get('client_id'), CLIENT.id);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('scope'), 'read_magellan write_magellan');
  assert.equal(url.searchParams.get('state'), 'state-1');

  const forged = await gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: GOOD_CODE,
    state: 'forged',
    redirectUri: REDIRECT,
  });
  assert.equal(forged.success, false);
  assert.match(forged.error, /unknown or expired/);

  const refused = await gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: 'stale',
    state: 'state-1',
    redirectUri: REDIRECT,
  });
  assert.equal(refused.success, false);
  assert.match(refused.error, /invalid_grant/);
  assert.match(gladys.fake.connectionStatus.message.fr, /La liaison du compte a échoué/);

  await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT);
  const ok = await gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: GOOD_CODE,
    state: 'state-2',
    redirectUri: REDIRECT,
  });
  assert.equal(ok.success, true);
  const exchange = netatmo.requests.filter((r) => r.path === '/oauth2/token').at(-1);
  assert.deepEqual(exchange.body, {
    grant_type: 'authorization_code',
    client_id: CLIENT.id,
    client_secret: CLIENT.secret,
    code: GOOD_CODE,
    redirect_uri: REDIRECT,
    scope: 'read_magellan write_magellan',
  });
  assert.equal(gladys.fake.config.refresh_token, tokenAnswer(1).refresh_token);
  assert.equal(gladys.fake.config.token_client_id, CLIENT.id);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Account linked: reading your homes…',
      fr: 'Compte lié : lecture de vos logements…',
    },
  });

  await firstRead(ctx);
  assert.equal(gladys.fake.discoveredDevices.length, 14);
  assert.match(gladys.fake.connectionStatus.message.en, /1 home, 14 devices/);
  assert.equal(netatmo.count('/api/homestatus'), 1, 'only the home with a Legrand gateway');
});

test('Connect needs the app credentials saved first', async (t) => {
  const { gladys } = await setup(t, { config: {} });
  assert.match(gladys.fake.connectionStatus.message.en, /Create an app on dev\.netatmo\.com/);
  const ack = await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT);
  assert.equal(ack.success, false);
  assert.match(ack.error, /save the configuration first/);
});

test('states are sent for the created devices only, the last values at creation', async (t) => {
  const ctx = await setup(t);
  const { gladys, netatmo } = ctx;
  await ctx.tick(0);
  assert.equal(netatmo.count('/api/homesdata'), 1);
  assert.equal(netatmo.count('/api/homestatus'), 0, 'background requests are spaced');
  await firstRead(ctx);
  assert.equal(netatmo.count('/api/homestatus'), 1);
  assert.equal(gladys.fake.discoveredDevices.length, 14);
  assert.equal(gladys.fake.states.length, 0);

  await create(ctx, M.OUTLET, M.THREE_PHASE);
  assert.equal(gladys.fake.lastState(feat(M.OUTLET, 'on')), 1);
  assert.equal(gladys.fake.lastState(feat(M.OUTLET, 'power')), 120);
  assert.equal(gladys.fake.lastState(feat(M.THREE_PHASE, 'power-3')), 96);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: dev(M.THREE_PHASE),
    transport: 'cloud',
  });

  netatmo.module(M.OUTLET).power = 150;
  netatmo.module(`${M.THREE_PHASE}#3`).power = 101;
  await ctx.run(60_000);
  assert.equal(netatmo.count('/api/homestatus'), 2);
  assert.equal(gladys.fake.lastState(feat(M.OUTLET, 'power')), 150);
  assert.equal(gladys.fake.lastState(feat(M.THREE_PHASE, 'power-3')), 101);
  assert.equal(
    gladys.fake.states.filter((s) => s.device_feature_external_id === feat(M.OUTLET, 'on')).length,
    1,
    'unchanged values are not sent again',
  );
  assert.equal(netatmo.count('/api/homesdata'), 1, 'the topology is read every 6 hours');
});

test('commands of a same home share one setstate, the states follow at once', async (t) => {
  const ctx = await setup(t);
  const { gladys, netatmo } = ctx;
  await firstRead(ctx);
  await create(ctx, M.DIMMER, `${M.DOUBLE}#1`);

  const acks = Promise.all([
    gladys.fake.setValue(deviceOf(ctx, M.DIMMER), featureOf(ctx, M.DIMMER, 'brightness'), 30),
    gladys.fake.setValue(deviceOf(ctx, `${M.DOUBLE}#1`), featureOf(ctx, `${M.DOUBLE}#1`, 'on'), 0),
  ]);
  await ctx.tick(TIMINGS.commandBatch);
  assert.deepEqual(await acks, [{ success: true }, { success: true }]);
  const sets = netatmo.requests.filter((r) => r.path === '/api/setstate');
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].body, {
    home: {
      id: HOME_ID,
      modules: [
        { id: M.DIMMER, bridge: M.GATEWAY, brightness: 30 },
        { id: `${M.DOUBLE}#1`, bridge: M.GATEWAY, on: false },
      ],
    },
  });
  assert.equal(gladys.fake.lastState(feat(M.DIMMER, 'brightness')), 30);
  assert.equal(gladys.fake.lastState(feat(`${M.DOUBLE}#1`, 'on')), 0);

  const reads = netatmo.count('/api/homestatus');
  await ctx.run(TIMINGS.confirmDelay);
  assert.equal(netatmo.count('/api/homestatus'), reads + 1, 'the home is read again');
});

test('shutters: open, stop and a position', async (t) => {
  const ctx = await setup(t);
  const { gladys, netatmo } = ctx;
  await firstRead(ctx);
  await create(ctx, M.SHUTTER, M.LEVEL_SHUTTER);
  assert.equal(gladys.fake.lastState(feat(M.SHUTTER, 'state')), -1);
  assert.equal(gladys.fake.lastState(feat(M.LEVEL_SHUTTER, 'position')), 40);

  assert.deepEqual(await command(ctx, M.SHUTTER, 'state', 1), { success: true });
  assert.deepEqual(await command(ctx, M.LEVEL_SHUTTER, 'state', 0), { success: true });
  assert.deepEqual(await command(ctx, M.LEVEL_SHUTTER, 'position', 75), { success: true });
  const modules = netatmo.requests
    .filter((r) => r.path === '/api/setstate')
    .map((r) => r.body.home.modules[0]);
  assert.deepEqual(
    modules.map(({ id, target_position }) => [id, target_position]),
    [
      [M.SHUTTER, 100],
      [M.LEVEL_SHUTTER, -1],
      [M.LEVEL_SHUTTER, 75],
    ],
  );
  assert.equal(gladys.fake.lastState(feat(M.SHUTTER, 'state')), 1);
  assert.equal(gladys.fake.lastState(feat(M.LEVEL_SHUTTER, 'position')), 75);
});

test('a module error fails the command with a readable message', async (t) => {
  const ctx = await setup(t);
  await firstRead(ctx);
  await create(ctx, M.OUTLET, M.METER);
  ctx.netatmo.setstateErrors.push({ id: M.OUTLET, code: 6 });
  const ack = await command(ctx, M.OUTLET, 'on', 0);
  assert.deepEqual(ack, { success: false, error: 'the module is unreachable' });
  assert.equal(ctx.gladys.fake.lastState(feat(M.OUTLET, 'on')), 1, 'no state shown');

  ctx.netatmo.setstateErrors.push({ id: M.OUTLET, code: 23 });
  assert.deepEqual(await command(ctx, M.OUTLET, 'on', 1), { success: true }, 'already on');

  const readOnly = await command(ctx, M.METER, 'power', 3);
  assert.equal(readOnly.success, false);
  assert.match(readOnly.error, /read-only/);
});

test('a command waiting for the request budget is acked, then sent', async (t) => {
  const ctx = await setup(t);
  await firstRead(ctx);
  await create(ctx, M.LIGHT);
  ctx.app.limiter.pause(Date.now() + 20_000);
  const ack = ctx.gladys.fake.setValue(deviceOf(ctx, M.LIGHT), featureOf(ctx, M.LIGHT, 'on'), 0);
  await ctx.tick(TIMINGS.commandBatch);
  await ctx.tick(TIMINGS.commandAck);
  assert.deepEqual(await ack, { success: true });
  assert.equal(ctx.netatmo.count('/api/setstate'), 0);
  await ctx.run(20_000);
  assert.equal(ctx.netatmo.count('/api/setstate'), 1);
  assert.equal(ctx.gladys.fake.lastState(feat(M.LIGHT, 'on')), 0);
});

test('an expired access token is refreshed, and the rotated tokens saved', async (t) => {
  const ctx = await setup(t);
  await firstRead(ctx);
  ctx.netatmo.expireAccess();
  // The poll at 65 s is refused, the replay waits for the request spacing.
  await ctx.run(65_000);
  assert.equal(ctx.netatmo.count('/api/homestatus'), 3, 'refused, then replayed');
  assert.equal(ctx.gladys.fake.config.refresh_token, tokenAnswer(2).refresh_token);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);

  // Three hours later, the token is refreshed before Netatmo refuses it.
  const refused = ctx.netatmo.refused;
  await ctx.run(3 * 3_600_000);
  assert.equal(ctx.gladys.fake.config.refresh_token, tokenAnswer(3).refresh_token);
  assert.equal(ctx.netatmo.refused, refused, 'no request refused on the way');
});

test('a revoked authorization asks to connect again and stops the polling', async (t) => {
  const ctx = await setup(t);
  const { gladys, netatmo } = ctx;
  await firstRead(ctx);
  await create(ctx, M.OUTLET);
  netatmo.expireAccess();
  netatmo.validRefresh = 'revoked-from-the-netatmo-account';
  await ctx.run(60_000);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /click Connect again/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: dev(M.OUTLET),
    transport: 'unreachable',
  });
  const requests = netatmo.requests.length;
  await ctx.run(5 * 60_000);
  assert.equal(netatmo.requests.length, requests, 'no request until the user acts');
  const ack = await command(ctx, M.OUTLET, 'on', 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Connect again/);

  // Connect again: polling resumes.
  await gladys.fake.oauthAuthorizeUrl(OAUTH_FIELD, REDIRECT);
  await gladys.fake.oauthCallback(OAUTH_FIELD, {
    code: GOOD_CODE,
    state: 'state-1',
    redirectUri: REDIRECT,
  });
  await firstRead(ctx);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
});

test('a usage limit pauses the polling, an outage shows the devices unreachable', async (t) => {
  const ctx = await setup(t);
  const { gladys, netatmo } = ctx;
  await firstRead(ctx);
  await create(ctx, M.OUTLET);
  netatmo.once(
    (r) => r.path === '/api/homestatus',
    answer(403, { error: { code: 26, message: 'User usage reached' } }),
  );
  await ctx.run(60_000);
  assert.match(gladys.fake.connectionStatus.message.en, /usage limit reached: next try in 15/);
  const reads = netatmo.count('/api/homestatus');
  await ctx.run(14 * 60_000);
  assert.equal(netatmo.count('/api/homestatus'), reads, 'paused');
  await ctx.run(60_000);
  assert.equal(netatmo.count('/api/homestatus'), reads + 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);

  netatmo.offline = true;
  await ctx.run(60_000);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Reading Netatmo failed: Netatmo is unreachable \(ENOTFOUND\)/,
  );
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud', 'one failure is not an outage');
  await ctx.run(60_000);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  netatmo.offline = false;
  await ctx.run(2 * 60_000);
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the test button, the scan and a client ID change', async (t) => {
  const ctx = await setup(t);
  const { gladys, netatmo } = ctx;
  await firstRead(ctx);

  const result = gladys.fake.action(ACTIONS.TEST, {});
  await ctx.run(12_000);
  const ack = await result;
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connection OK: 1 home with Legrand Home + Control, 14 devices for Gladys, 2 modules not supported yet.',
  );
  assert.equal(netatmo.count('/api/homesdata'), 2);

  netatmo.homesdata.body.homes[0].modules.find((m) => m.id === M.OUTLET).name = 'Prise TV';
  await ctx.run(60_000);
  const scan = gladys.fake.scanRequest();
  await ctx.run(12_000);
  await scan;
  assert.equal(netatmo.count('/api/homesdata'), 3, 'a scan re-reads the topology');
  assert.equal(
    gladys.fake.discoveredDevices.find((d) => d.external_id === dev(M.OUTLET)).name,
    'Prise TV',
  );

  await gladys.fake.configUpdated({ ...LINKED, client_id: 'another-app' });
  await settle();
  assert.equal(gladys.fake.config.refresh_token, '', 'the tokens of the old app are wiped');
  assert.match(gladys.fake.connectionStatus.message.en, /Click Connect/);
  const notLinked = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(notLinked.data.message.en, /Click Connect/);
});
