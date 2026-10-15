// -----------------------------------------------------------------------------
// Gladys commands -> the module entries of a setstate request, and the states
// to show right away once Netatmo accepted them (pure).
//
// setstate takes the format of a homestatus answer: one object per module,
// `{ id, bridge, on | brightness | target_position }`. Shutter positions: 100
// opens, 0 closes, -1 stops, anything between for the modules that support it.
// -----------------------------------------------------------------------------

import { FEATURES } from './devices.js';
import { COVER_STATE } from './states.js';

const SHUTTER_TARGETS = {
  [COVER_STATE.OPEN]: 100,
  [COVER_STATE.CLOSE]: 0,
  [COVER_STATE.STOP]: -1,
};

const percent = (value) => Math.max(0, Math.min(100, Math.round(Number(value))));

/** Setstate error codes (Netatmo glossary) -> what the user reads. */
export const MODULE_ERRORS = {
  1: 'unknown error',
  2: 'internal error',
  3: 'parser error',
  5: 'the module refused the parameters',
  6: 'the module is unreachable',
  7: 'the module failed to apply the command',
  8: 'the battery of the module is too low',
  14: 'the module is busy, try again',
  19: 'the module is unreachable',
  27: 'the module is temporarily banned',
};

/** A setstate error code that is a success (the module was already in that state). */
export const NOTHING_TO_MODIFY = 23;

/**
 * The fields of the module entry for one command.
 * @param {object} route - The feature route (key, step...).
 * @param {number} value - The value Gladys sends.
 * @param {object} [status] - The last status of the module (shutter step).
 */
export function commandFields(route, value, status) {
  const v = Number(value);
  if (!Number.isFinite(v)) {
    throw new Error(`invalid value ${value}`);
  }
  switch (route.key) {
    case FEATURES.ON:
      return { on: v >= 1 };
    case FEATURES.BRIGHTNESS: {
      const brightness = percent(v);
      return brightness === 0 ? { on: false } : { brightness };
    }
    case FEATURES.STATE: {
      const target = SHUTTER_TARGETS[v];
      if (target === undefined) {
        throw new Error(`unknown shutter command ${value}`);
      }
      return { target_position: target };
    }
    case FEATURES.POSITION: {
      const step = Number(status?.['target_position:step'] ?? status?.target_position_step);
      let position = percent(v);
      if (Number.isFinite(step) && step > 1 && step <= 100) {
        position = Math.min(100, Math.round(position / step) * step);
      }
      return { target_position: position };
    }
    default:
      throw new Error(`${route.key} is read-only`);
  }
}

/** The module entry of a setstate request. */
export function moduleEntry(route, fields) {
  return { id: route.moduleId, ...(route.bridge ? { bridge: route.bridge } : {}), ...fields };
}

/**
 * The states to show once Netatmo accepted the command: [featureKey, value].
 * A shutter shows its target; the next read gives its real position.
 */
export function expectedStates(route, value) {
  const v = Number(value);
  switch (route.key) {
    case FEATURES.ON:
      return [[FEATURES.ON, v >= 1 ? 1 : 0]];
    case FEATURES.BRIGHTNESS:
      return percent(v) === 0 ? [[FEATURES.ON, 0]] : [[FEATURES.BRIGHTNESS, percent(v)]];
    case FEATURES.STATE:
      return [[FEATURES.STATE, v]];
    case FEATURES.POSITION:
      return [[FEATURES.POSITION, percent(v)]];
    default:
      return [];
  }
}
