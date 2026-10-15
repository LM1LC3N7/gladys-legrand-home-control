// -----------------------------------------------------------------------------
// homestatus -> the values of the Gladys features and the reachability of the
// devices (pure). Value enums follow the Gladys core (server/utils/constants.js).
// -----------------------------------------------------------------------------

import { parentOf } from './catalog.js';
import { FEATURES } from './devices.js';

/** Shutter states of the Gladys core (COVER_STATE). */
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };

/** Netatmo `battery_state` -> percent (the levels of pyatmo). */
export const BATTERY_LEVELS = {
  max: 100,
  full: 90,
  high: 75,
  medium: 50,
  low: 25,
  very_low: 10,
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const inRange = (v) => v !== undefined && v >= 0 && v <= 100;

/**
 * Open (1), closed (-1) or stopped half-way (0), from the positions. A module
 * moving towards its target is opening or closing. 101 means "never
 * positioned since installed": only the target tells then.
 */
export function shutterState(status) {
  const current = num(status?.current_position);
  const target = num(status?.target_position);
  if (inRange(current)) {
    if (inRange(target) && target !== current) {
      return target > current ? COVER_STATE.OPEN : COVER_STATE.CLOSE;
    }
    if (current === 0) {
      return COVER_STATE.CLOSE;
    }
    return current === 100 ? COVER_STATE.OPEN : COVER_STATE.STOP;
  }
  if (target === 0) {
    return COVER_STATE.CLOSE;
  }
  return target === 100 ? COVER_STATE.OPEN : undefined;
}

export function batteryPercent(status) {
  const percent = num(status?.battery_percent);
  if (percent !== undefined) {
    return Math.max(0, Math.min(100, Math.round(percent)));
  }
  return BATTERY_LEVELS[status?.battery_state];
}

/** The value of one feature in its module status, or undefined. */
export function readValue(key, status) {
  if (!status) {
    return undefined;
  }
  switch (key) {
    case FEATURES.ON:
      return typeof status.on === 'boolean' ? Number(status.on) : undefined;
    case FEATURES.BRIGHTNESS: {
      const v = num(status.brightness);
      return inRange(v) ? Math.round(v) : undefined;
    }
    case FEATURES.POWER: {
      const v = num(status.power);
      return v !== undefined && v >= 0 ? v : undefined;
    }
    case FEATURES.STATE:
      return shutterState(status);
    case FEATURES.POSITION: {
      const v = num(status.current_position);
      return inRange(v) ? Math.round(v) : undefined;
    }
    case FEATURES.BATTERY:
      return batteryPercent(status);
    default:
      return undefined;
  }
}

/**
 * Whether a module answers: false when homestatus reports an error for it,
 * its parent or its bridge, or says `reachable: false`; undefined when the
 * status says nothing about it.
 */
export function reachability(moduleId, bridge, statusById, errorIds) {
  const own = statusById.get(moduleId);
  const parentId = parentOf(moduleId);
  const parent = statusById.get(parentId);
  if (errorIds.has(moduleId) || errorIds.has(parentId) || (bridge && errorIds.has(bridge))) {
    return false;
  }
  if (own?.reachable === false || parent?.reachable === false) {
    return false;
  }
  if (bridge && statusById.get(bridge)?.reachable === false) {
    return false;
  }
  if (own?.reachable === true || parent?.reachable === true) {
    return true;
  }
  // Modules that never send `reachable` are signalled by their presence.
  return own || parent ? true : undefined;
}

/**
 * Every value and reachability the statuses give.
 * @returns {{ values: Map<string, number>, reachable: Map<string, boolean> }}
 */
export function readStates(model, statuses) {
  const values = new Map();
  const reachable = new Map();
  const indexes = new Map();
  const indexOf = (homeId) => {
    if (!indexes.has(homeId)) {
      const status = statuses.get(homeId);
      indexes.set(homeId, {
        statusById: new Map(
          (status?.home?.modules ?? []).filter((m) => m?.id).map((m) => [m.id, m]),
        ),
        errorIds: new Set((status?.errors ?? []).map((e) => String(e?.id))),
        known: status !== undefined,
      });
    }
    return indexes.get(homeId);
  };
  for (const route of model.routes.values()) {
    const { statusById, errorIds } = indexOf(route.homeId);
    if (errorIds.has(route.statusId) || errorIds.has(parentOf(route.statusId))) {
      continue;
    }
    const value = readValue(route.key, statusById.get(route.statusId));
    if (value !== undefined) {
      values.set(route.featureId, value);
    }
  }
  for (const [deviceId, { homeId, moduleId, bridge }] of model.deviceModules) {
    const { statusById, errorIds, known } = indexOf(homeId);
    if (!known) {
      continue;
    }
    const r = reachability(moduleId, bridge, statusById, errorIds);
    if (r !== undefined) {
      reachable.set(deviceId, r);
    }
  }
  return { values, reachable };
}
