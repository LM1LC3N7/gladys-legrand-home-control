import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { describe as describeModule, KINDS } from '../src/catalog.js';
import { buildModel, mergeSeen, platformId } from '../src/devices.js';
import { HOMESDATA, HOMESTATUS, HOME_ID, M } from './fixtures/netatmo.js';

const gladys = createFakeGladys();
const homes = HOMESDATA.body.homes;
const statuses = new Map([[HOME_ID, HOMESTATUS.body]]);
const idOf = (moduleId) => `ext:test-integration:module:${platformId(moduleId)}`;

function full() {
  return buildModel(gladys, homes, statuses, mergeSeen(new Map(), HOMESTATUS.body));
}

const device = (model, moduleId) => model.devices.find((d) => d.external_id === idOf(moduleId));
const shape = (d) => d.features.map((f) => `${f.category}/${f.type}${f.read_only ? ' (ro)' : ''}`);

test('module ids become stable external ids', () => {
  assert.equal(platformId('00:04:74:00:00:01:AA:07#2'), '000474000001aa07-2');
  assert.equal(idOf(M.OUTLET), 'ext:test-integration:module:000474000001aa01');
});

test('one device per Home + Control module, the gateway and the others left out', () => {
  const model = full();
  assert.deepEqual(model.homes, [{ id: HOME_ID, name: 'Maison', modules: 22 }]);
  assert.equal(model.devices.length, 14);
  assert.deepEqual(
    model.skipped.map((s) => s.id),
    [`${M.ECOMETER}#0`, M.BATTERYLESS],
    'the ecometer line (no power in homestatus) and the batteryless switch',
  );
  assert.equal(device(model, M.GATEWAY), undefined);
  assert.equal(device(model, M.DOUBLE), undefined, 'the double switch container');
  assert.equal(
    model.devices.some((d) => d.model.includes('NAPlug')),
    false,
    'the thermostat is not Home + Control',
  );
});

test('outlets, contactors and relays are switches with their power', () => {
  const model = full();
  const outlet = device(model, M.OUTLET);
  assert.equal(outlet.name, 'Prise salon');
  assert.equal(outlet.model, 'Legrand Power outlet (NLP)');
  assert.equal(outlet.should_poll, false);
  assert.deepEqual(shape(outlet), ['switch/binary', 'switch/power (ro)']);
  assert.deepEqual(outlet.params, [
    { name: 'NETATMO_HOME_ID', value: HOME_ID },
    { name: 'NETATMO_MODULE_ID', value: M.OUTLET },
    { name: 'NETATMO_MODULE_TYPE', value: 'NLP' },
    { name: 'NETATMO_BRIDGE_ID', value: M.GATEWAY },
    { name: 'NETATMO_ROOM', value: 'Salon' },
  ]);
  assert.equal(outlet.features[1].unit, 'watt');
  assert.deepEqual(shape(device(model, M.CONTACTOR)), ['switch/binary', 'switch/power (ro)']);
  assert.deepEqual(
    shape(device(model, M.TELERUPTOR)),
    ['light/binary', 'light/power (ro)'],
    'a teleruptor driving a light is a light',
  );
  assert.deepEqual(
    shape(device(model, M.RADIATOR)),
    ['switch/power (ro)'],
    'a pilot-wire radiator takes modes, not on/off',
  );
});

test('lights, dimmers and the gangs of a double switch', () => {
  const model = full();
  assert.deepEqual(shape(device(model, M.LIGHT)), ['light/binary', 'light/power (ro)']);
  const dimmer = device(model, M.DIMMER);
  assert.deepEqual(shape(dimmer), ['light/binary', 'light/brightness', 'light/power (ro)']);
  assert.deepEqual(
    [dimmer.features[1].min, dimmer.features[1].max, dimmer.features[1].unit],
    [0, 100, 'percent'],
  );
  const left = device(model, `${M.DOUBLE}#1`);
  assert.equal(left.name, 'Applique gauche');
  assert.equal(left.external_id, 'ext:test-integration:module:000474000001aa07-1');
  assert.deepEqual(shape(left), ['light/binary', 'light/power (ro)']);
  assert.equal(device(model, `${M.DOUBLE}#2`).name, 'Applique droite');
});

test('shutters get a position only when the module has one', () => {
  const model = full();
  const plain = device(model, M.SHUTTER);
  assert.deepEqual(shape(plain), ['shutter/state']);
  assert.deepEqual([plain.features[0].min, plain.features[0].max], [-1, 1]);
  assert.deepEqual(shape(device(model, M.LEVEL_SHUTTER)), ['shutter/state', 'shutter/position']);
});

test('meters, phases, remotes and a module type the catalog does not know', () => {
  const model = full();
  assert.deepEqual(shape(device(model, M.METER)), ['energy-sensor/power (ro)']);
  const phases = device(model, M.THREE_PHASE);
  assert.deepEqual(
    phases.features.map((f) => [f.name, f.external_id.split(':').at(-1)]),
    [
      ['Power', 'power'],
      ['Power phase 1', 'power-1'],
      ['Power phase 2', 'power-2'],
      ['Power phase 3', 'power-3'],
    ],
  );
  assert.equal(phases.features[0].max, 50_000);
  assert.deepEqual(shape(device(model, M.REMOTE)), ['battery/integer (ro)']);
  assert.deepEqual(shape(device(model, M.FUTURE)), ['switch/binary', 'switch/power (ro)']);
  assert.deepEqual(model.routes.get(`${idOf(M.THREE_PHASE)}:power-2`), {
    featureId: `${idOf(M.THREE_PHASE)}:power-2`,
    deviceId: idOf(M.THREE_PHASE),
    homeId: HOME_ID,
    moduleId: M.THREE_PHASE,
    statusId: `${M.THREE_PHASE}#2`,
    bridge: M.GATEWAY,
    key: 'power',
    type: 'NLY',
    readOnly: true,
  });
});

test('before the first status: the catalog alone', () => {
  const model = buildModel(gladys, homes);
  assert.equal(model.devices.length, 12, 'the remote battery and the unknown type wait');
  assert.deepEqual(describeModule('NLZZ', undefined).kind, KINDS.IGNORED);
  assert.equal(describeModule('NAPlug', {}), null);
  assert.equal(describeModule('NLXX', { brightness: 10 }).kind, KINDS.DIMMER);
  assert.equal(describeModule('Z3X', { target_position: 0 }).kind, KINDS.SHUTTER);
});

test('a feature seen once stays (an unreachable module does not lose it)', () => {
  const seen = mergeSeen(new Map(), HOMESTATUS.body);
  const quiet = structuredClone(HOMESTATUS.body);
  quiet.home.modules = quiet.home.modules.filter((m) => m.id !== M.REMOTE);
  mergeSeen(seen, quiet);
  const model = buildModel(gladys, homes, new Map([[HOME_ID, quiet]]), seen);
  assert.deepEqual(shape(device(model, M.REMOTE)), ['battery/integer (ro)']);
});
