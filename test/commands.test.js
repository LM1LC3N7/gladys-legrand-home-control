import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandFields, expectedStates, moduleEntry } from '../src/commands.js';
import { COVER_STATE } from '../src/states.js';

const route = (key, extra = {}) => ({ key, moduleId: 'mod', bridge: 'gw', ...extra });

test('on/off and brightness', () => {
  assert.deepEqual(commandFields(route('on'), 1), { on: true });
  assert.deepEqual(commandFields(route('on'), 0), { on: false });
  assert.deepEqual(commandFields(route('brightness'), 42.4), { brightness: 42 });
  assert.deepEqual(commandFields(route('brightness'), 150), { brightness: 100 });
  assert.deepEqual(commandFields(route('brightness'), 0), { on: false }, 'brightness 0 turns off');
  assert.throws(() => commandFields(route('on'), 'abc'), /invalid value/);
});

test('shutters: open, close, stop and positions on the step of the module', () => {
  assert.deepEqual(commandFields(route('state'), COVER_STATE.OPEN), { target_position: 100 });
  assert.deepEqual(commandFields(route('state'), COVER_STATE.CLOSE), { target_position: 0 });
  assert.deepEqual(commandFields(route('state'), COVER_STATE.STOP), { target_position: -1 });
  assert.throws(() => commandFields(route('state'), 2), /unknown shutter command/);
  assert.deepEqual(commandFields(route('position'), 37), { target_position: 37 });
  assert.deepEqual(commandFields(route('position'), 37, { 'target_position:step': 5 }), {
    target_position: 35,
  });
  assert.deepEqual(commandFields(route('position'), 120, { 'target_position:step': 1 }), {
    target_position: 100,
  });
});

test('read-only features refuse commands', () => {
  assert.throws(() => commandFields(route('power'), 1), /read-only/);
  assert.throws(() => commandFields(route('battery'), 1), /read-only/);
});

test('the setstate entry and the states shown once accepted', () => {
  assert.deepEqual(moduleEntry(route('on'), { on: true }), { id: 'mod', bridge: 'gw', on: true });
  assert.deepEqual(moduleEntry(route('on', { bridge: undefined }), { on: true }), {
    id: 'mod',
    on: true,
  });
  assert.deepEqual(expectedStates(route('on'), 1), [['on', 1]]);
  assert.deepEqual(expectedStates(route('brightness'), 0), [['on', 0]]);
  assert.deepEqual(expectedStates(route('brightness'), 55), [['brightness', 55]]);
  assert.deepEqual(expectedStates(route('state'), -1), [['state', -1]]);
  assert.deepEqual(expectedStates(route('position'), 30), [['position', 30]]);
});
