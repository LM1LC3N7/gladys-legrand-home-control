import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LIMITS } from '../src/constants.js';
import { StatePublisher } from '../src/publisher.js';

const feature = (i) => `ext:test-integration:module:m${i}:power`;

function setup() {
  const gladys = createFakeGladys();
  let t = 1_760_000_000_000;
  const publisher = new StatePublisher({ gladys, now: () => t });
  return { gladys, publisher, advance: (ms) => (t += ms) };
}

test('the states stay within the Gladys budget, the rest waits for the next minute', async () => {
  const { gladys, publisher, advance } = setup();
  for (let i = 0; i < 300; i += 1) {
    publisher.push(feature(i), i);
  }
  assert.equal(await publisher.flush(), LIMITS.statesPerMinute);
  assert.equal(await publisher.flush(), 0, 'budget spent');
  advance(60_000);
  assert.equal(await publisher.flush(), 300 - LIMITS.statesPerMinute);
  assert.equal(gladys.fake.states.length, 300);
});

test('a failed publication keeps the values, unless a newer one arrived', async (t) => {
  const { gladys, publisher } = setup();
  publisher.push(feature(1), 10);
  publisher.push(feature(2), 20);
  t.mock.method(gladys, 'publishChangedStates', async () => {
    publisher.push(feature(2), 21);
    throw new Error('429');
  });
  assert.equal(await publisher.flush(), 0);
  t.mock.restoreAll();
  publisher.forget('ext:test-integration:module:m1');
  assert.equal(await publisher.flush(), 1);
  assert.deepEqual(
    gladys.fake.states.map((s) => [s.device_feature_external_id, s.state]),
    [[feature(2), 21]],
  );
});
