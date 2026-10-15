import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, mergeSeen, platformId } from '../src/devices.js';
import { COVER_STATE, batteryPercent, readStates, shutterState } from '../src/states.js';
import { HOMESDATA, HOMESTATUS, HOME_ID, M } from './fixtures/netatmo.js';

const gladys = createFakeGladys();
const id = (moduleId, key) => `ext:test-integration:module:${platformId(moduleId)}:${key}`;
const dev = (moduleId) => `ext:test-integration:module:${platformId(moduleId)}`;

function read(body = HOMESTATUS.body) {
  const statuses = new Map([[HOME_ID, body]]);
  const model = buildModel(
    gladys,
    HOMESDATA.body.homes,
    statuses,
    mergeSeen(new Map(), HOMESTATUS.body),
  );
  return readStates(model, statuses);
}

test('shutter state from the positions', () => {
  assert.equal(shutterState({ current_position: 0, target_position: 0 }), COVER_STATE.CLOSE);
  assert.equal(shutterState({ current_position: 100, target_position: 100 }), COVER_STATE.OPEN);
  assert.equal(shutterState({ current_position: 40, target_position: 40 }), COVER_STATE.STOP);
  assert.equal(shutterState({ current_position: 0, target_position: 10 }), COVER_STATE.OPEN);
  assert.equal(shutterState({ current_position: 80, target_position: 0 }), COVER_STATE.CLOSE);
  assert.equal(
    shutterState({ current_position: 101, target_position: 100 }),
    COVER_STATE.OPEN,
    '101: never positioned, the target tells',
  );
  assert.equal(shutterState({ current_position: 101, target_position: 50 }), undefined);
  assert.equal(shutterState({}), undefined);
  assert.equal(batteryPercent({ battery_state: 'very_low' }), 10);
  assert.equal(batteryPercent({ battery_percent: 63.4, battery_state: 'full' }), 63);
  assert.equal(batteryPercent({ battery_state: 'strange' }), undefined);
});

test('every feature reads its value in homestatus', () => {
  const { values, reachable } = read();
  const expected = {
    [id(M.OUTLET, 'on')]: 1,
    [id(M.OUTLET, 'power')]: 120,
    [id(M.TELERUPTOR, 'on')]: 0,
    [id(M.CONTACTOR, 'power')]: 2100,
    [id(M.RADIATOR, 'power')]: 0,
    [id(M.DIMMER, 'on')]: 1,
    [id(M.DIMMER, 'brightness')]: 63,
    [id(`${M.DOUBLE}#1`, 'on')]: 1,
    [id(`${M.DOUBLE}#2`, 'on')]: 0,
    [id(M.SHUTTER, 'state')]: COVER_STATE.CLOSE,
    [id(M.LEVEL_SHUTTER, 'state')]: COVER_STATE.STOP,
    [id(M.LEVEL_SHUTTER, 'position')]: 40,
    [id(M.METER, 'power')]: 476,
    [id(M.THREE_PHASE, 'power')]: 160,
    [id(M.THREE_PHASE, 'power-1')]: 0,
    [id(M.THREE_PHASE, 'power-2')]: 64,
    [id(M.THREE_PHASE, 'power-3')]: 96,
    [id(M.REMOTE, 'battery')]: 75,
    [id(M.FUTURE, 'on')]: 0,
  };
  for (const [featureId, value] of Object.entries(expected)) {
    assert.equal(values.get(featureId), value, featureId);
  }
  assert.equal(values.size, 27);
  assert.equal(reachable.size, 14);
  assert.ok([...reachable.values()].every((r) => r === true));
  assert.equal(reachable.get(dev(`${M.DOUBLE}#1`)), true, 'a gang follows its switch');
});

test('a module in error or behind an offline gateway is unreachable', () => {
  const body = structuredClone(HOMESTATUS.body);
  body.errors = [{ id: M.SHUTTER, code: 6 }];
  body.home.modules = body.home.modules.filter((m) => m.id !== M.SHUTTER);
  body.home.modules.find((m) => m.id === M.DOUBLE).reachable = false;
  const { values, reachable } = read(body);
  assert.equal(values.has(id(M.SHUTTER, 'state')), false);
  assert.equal(reachable.get(dev(M.SHUTTER)), false);
  assert.equal(reachable.get(dev(`${M.DOUBLE}#2`)), false, 'the switch of the gang is offline');
  assert.equal(reachable.get(dev(M.OUTLET)), true);

  const offline = structuredClone(HOMESTATUS.body);
  offline.home.modules.find((m) => m.id === M.GATEWAY).reachable = false;
  const gatewayDown = read(offline).reachable;
  assert.equal(gatewayDown.get(dev(M.OUTLET)), false);
  assert.equal(gatewayDown.get(dev(M.REMOTE)), false);
});
