import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig } from '../src/config.js';
import { POLL_INTERVAL } from '../src/constants.js';

test('the defaults: no app, one minute', () => {
  assert.deepEqual(normalizeConfig(), {
    clientId: '',
    clientSecret: '',
    hasApp: false,
    pollInterval: DEFAULTS.poll_interval,
  });
  assert.deepEqual(normalizeConfig(null), normalizeConfig({}));
});

test('the app credentials are trimmed and both needed', () => {
  const config = normalizeConfig({ client_id: ' abc ', client_secret: ' s3cret ' });
  assert.equal(config.clientId, 'abc');
  assert.equal(config.clientSecret, 's3cret');
  assert.equal(config.hasApp, true);
  assert.equal(normalizeConfig({ client_id: 'abc' }).hasApp, false);
  assert.equal(normalizeConfig({ client_id: 'abc', client_secret: null }).hasApp, false);
});

test('the refresh interval stays within the Netatmo usage limits', () => {
  assert.equal(normalizeConfig({ poll_interval: 10 }).pollInterval, POLL_INTERVAL.min);
  assert.equal(normalizeConfig({ poll_interval: 99_999 }).pollInterval, POLL_INTERVAL.max);
  assert.equal(normalizeConfig({ poll_interval: '120.4' }).pollInterval, 120);
  assert.equal(normalizeConfig({ poll_interval: 'soon' }).pollInterval, POLL_INTERVAL.default);
});
