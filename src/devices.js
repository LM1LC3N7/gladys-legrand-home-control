// -----------------------------------------------------------------------------
// The homes topology (homesdata) and the module states (homestatus) -> Gladys
// devices and the routing table of their features (pure).
//
// One Gladys device per Home + Control module. A double switch (NLIS) answers
// one `<id>#<n>` entry per gang: each gang is a device of its own. A
// three-phase meter (NLY) answers one entry per phase: they are features of
// the meter. External ids come from the module ids (MAC addresses): stable
// across restarts, renames and room changes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { KINDS, describe, isSubModule, parentOf, SUB_SEPARATOR } from './catalog.js';

export const DEVICE_TYPE = 'module';

/** Feature keys: the end of the feature external ids, frozen. */
export const FEATURES = {
  ON: 'on',
  BRIGHTNESS: 'brightness',
  POWER: 'power',
  STATE: 'state',
  POSITION: 'position',
  BATTERY: 'battery',
};

/** Device params: where a command goes, readable after a restart. */
export const PARAMS = {
  HOME: 'NETATMO_HOME_ID',
  MODULE: 'NETATMO_MODULE_ID',
  TYPE: 'NETATMO_MODULE_TYPE',
  BRIDGE: 'NETATMO_BRIDGE_ID',
  ROOM: 'NETATMO_ROOM',
};

/** `12:34:56:00:01:01:01:b6#1` -> `12345600010101b6-1`. */
export function platformId(moduleId) {
  return String(moduleId)
    .toLowerCase()
    .replace(/[^0-9a-z#]/g, '')
    .replace(SUB_SEPARATOR, '-');
}

/** What the statuses read so far told about each module (never forgotten). */
export function mergeSeen(seen, status) {
  for (const m of status?.home?.modules ?? []) {
    if (typeof m?.id !== 'string') {
      continue;
    }
    const entry = seen.get(m.id) ?? { power: false, battery: false, step: undefined };
    if (typeof m.power === 'number') {
      entry.power = true;
    }
    if (typeof m.battery_state === 'string' || typeof m.battery_percent === 'number') {
      entry.battery = true;
    }
    const step = Number(m['target_position:step'] ?? m.target_position_step);
    if (Number.isFinite(step) && step > 0) {
      entry.step = step;
    }
    seen.set(m.id, entry);
  }
  return seen;
}

const POWER_TYPES = {
  [C.SWITCH]: T.SWITCH.POWER,
  [C.LIGHT]: T.LIGHT.POWER,
  [C.ENERGY_SENSOR]: T.ENERGY_SENSOR.POWER,
};
/** Watts: a 16 A outlet stays under 4 kW, a three-phase supply under 50 kW. */
const POWER_MAX = { [C.ENERGY_SENSOR]: 50_000 };

function feature(ids, key, name, spec) {
  return {
    name,
    external_id: ids.feature(key),
    min: 0,
    read_only: false,
    has_feedback: true,
    keep_history: true,
    ...spec,
  };
}

const onOff = (ids, category) =>
  feature(ids, FEATURES.ON, 'On/Off', { category, type: T.SWITCH.BINARY, max: 1 });

const power = (ids, category, key = FEATURES.POWER, name = 'Power') =>
  feature(ids, key, name, {
    category,
    type: POWER_TYPES[category],
    unit: U.WATT,
    max: POWER_MAX[category] ?? 10_000,
    read_only: true,
    has_feedback: false,
  });

/**
 * The features of one module, and the status entry each one reads:
 * [{ feature, key, statusId }].
 */
function featuresOf(ids, module, desc, seen, gangs) {
  const s = seen.get(module.id) ?? {};
  const own = (f, key) => ({ feature: f, key, statusId: module.id });
  const withPower = desc.power || s.power;
  switch (desc.kind) {
    case KINDS.SWITCH: {
      const category = module.appliance_type === 'light' ? C.LIGHT : C.SWITCH;
      const list = [];
      // A cable outlet driving a pilot-wire radiator takes modes, not on/off.
      if (module.appliance_type !== 'radiator') {
        list.push(own(onOff(ids, category), FEATURES.ON));
      }
      if (withPower) {
        list.push(own(power(ids, category), FEATURES.POWER));
      }
      return list;
    }
    case KINDS.LIGHT:
    case KINDS.DIMMER: {
      const list = [own(onOff(ids, C.LIGHT), FEATURES.ON)];
      if (desc.kind === KINDS.DIMMER) {
        list.push(
          own(
            feature(ids, FEATURES.BRIGHTNESS, 'Brightness', {
              category: C.LIGHT,
              type: T.LIGHT.BRIGHTNESS,
              unit: U.PERCENT,
              max: 100,
            }),
            FEATURES.BRIGHTNESS,
          ),
        );
      }
      if (withPower) {
        list.push(own(power(ids, C.LIGHT), FEATURES.POWER));
      }
      return list;
    }
    case KINDS.SHUTTER: {
      const list = [
        own(
          feature(ids, FEATURES.STATE, 'Open/Close', {
            category: C.SHUTTER,
            type: T.SHUTTER.STATE,
            min: -1,
            max: 1,
            keep_history: false,
          }),
          FEATURES.STATE,
        ),
      ];
      if (desc.position || (s.step !== undefined && s.step < 100)) {
        list.push(
          own(
            feature(ids, FEATURES.POSITION, 'Position', {
              category: C.SHUTTER,
              type: T.SHUTTER.POSITION,
              unit: U.PERCENT,
              max: 100,
            }),
            FEATURES.POSITION,
          ),
        );
      }
      return list;
    }
    case KINDS.METER: {
      const list = withPower ? [own(power(ids, C.ENERGY_SENSOR), FEATURES.POWER)] : [];
      if (desc.phases) {
        for (const gang of gangs) {
          const n = gang.id.split(SUB_SEPARATOR)[1];
          const key = `${FEATURES.POWER}-${platformId(n)}`;
          list.push({
            feature: power(ids, C.ENERGY_SENSOR, key, `Power phase ${n}`),
            key: FEATURES.POWER,
            statusId: gang.id,
          });
        }
      }
      return list;
    }
    case KINDS.REMOTE:
      return s.battery
        ? [
            own(
              feature(ids, FEATURES.BATTERY, 'Battery', {
                category: C.BATTERY,
                type: T.BATTERY.INTEGER,
                unit: U.PERCENT,
                max: 100,
                read_only: true,
                has_feedback: false,
              }),
              FEATURES.BATTERY,
            ),
          ]
        : [];
    default:
      return [];
  }
}

const shortId = (id) => platformId(id).slice(-6);

function nameOf(module, desc, byId) {
  const own = typeof module.name === 'string' ? module.name.trim() : '';
  if (own) {
    return own.slice(0, 100);
  }
  if (isSubModule(module.id)) {
    const parent = byId.get(parentOf(module.id));
    const parentName = typeof parent?.name === 'string' ? parent.name.trim() : '';
    const n = module.id.split(SUB_SEPARATOR)[1];
    return `${parentName || `${desc.label} ${shortId(parentOf(module.id))}`} ${n}`;
  }
  return `${desc.label} ${shortId(module.id)}`;
}

/**
 * The Gladys model of the account.
 * @param {object} gladys - For the external ids.
 * @param {Array} homes - homesdata `body.homes`.
 * @param {Map} statuses - homeId -> homestatus `{ home, errors }`.
 * @param {Map} seen - moduleId -> what the statuses told (mergeSeen).
 */
export function buildModel(gladys, homes, statuses = new Map(), seen = new Map()) {
  const model = {
    homes: [],
    devices: [],
    /** featureId -> { featureId, deviceId, homeId, moduleId, statusId, bridge, key, type } */
    routes: new Map(),
    /** deviceId -> { homeId, moduleId, bridge } */
    deviceModules: new Map(),
    /** Modules of the family with nothing to show: [{ id, type }] */
    skipped: [],
  };
  const takenIds = new Set();
  for (const home of Array.isArray(homes) ? homes : []) {
    if (typeof home?.id !== 'string' || !Array.isArray(home.modules)) {
      continue;
    }
    const byId = new Map(
      home.modules.filter((m) => typeof m?.id === 'string').map((m) => [m.id, m]),
    );
    const statusById = new Map(
      (statuses.get(home.id)?.home?.modules ?? []).filter((m) => m?.id).map((m) => [m.id, m]),
    );
    const rooms = new Map((home.rooms ?? []).map((r) => [r.id, r.name]));
    const gangsOf = (id) =>
      [...byId.values()].filter((m) => isSubModule(m.id) && parentOf(m.id) === id);
    let legrand = 0;
    for (const module of byId.values()) {
      const desc = describe(module.type, statusById.get(module.id));
      if (!desc) {
        continue;
      }
      legrand += 1;
      if (desc.kind === KINDS.GATEWAY || takenIds.has(module.id)) {
        continue;
      }
      const sub = isSubModule(module.id);
      const parentDesc = sub ? describe(byId.get(parentOf(module.id))?.type ?? module.type) : null;
      if (sub && parentDesc?.phases) {
        continue; // a phase of its meter, read by the meter itself
      }
      const gangs = sub ? [] : gangsOf(module.id);
      if (!sub && gangs.length > 0 && !desc.phases) {
        continue; // the container of its gangs (NLIS): each gang is a device
      }
      const ids = gladys.externalIds(DEVICE_TYPE, platformId(module.id));
      const status = statusById.get(module.id) ?? statusById.get(parentOf(module.id));
      const bridge = module.bridge ?? status?.bridge;
      const features = featuresOf(ids, module, desc, seen, gangs);
      if (features.length === 0) {
        model.skipped.push({ id: module.id, type: module.type });
        continue;
      }
      takenIds.add(module.id);
      const room = rooms.get(module.room_id ?? byId.get(parentOf(module.id))?.room_id);
      const params = [
        { name: PARAMS.HOME, value: home.id },
        { name: PARAMS.MODULE, value: module.id },
        { name: PARAMS.TYPE, value: String(module.type) },
        ...(bridge ? [{ name: PARAMS.BRIDGE, value: String(bridge) }] : []),
        ...(room ? [{ name: PARAMS.ROOM, value: String(room) }] : []),
      ];
      model.devices.push({
        name: nameOf(module, desc, byId),
        external_id: ids.device,
        model: `Legrand ${desc.label} (${module.type})`,
        should_poll: false,
        params,
        features: features.map((f) => f.feature),
      });
      model.deviceModules.set(ids.device, { homeId: home.id, moduleId: module.id, bridge });
      for (const f of features) {
        model.routes.set(f.feature.external_id, {
          featureId: f.feature.external_id,
          deviceId: ids.device,
          homeId: home.id,
          moduleId: module.id,
          statusId: f.statusId,
          bridge,
          key: f.key,
          type: module.type,
          readOnly: f.feature.read_only,
        });
      }
    }
    if (legrand > 0) {
      model.homes.push({
        id: home.id,
        name: typeof home.name === 'string' ? home.name : home.id,
        modules: legrand,
      });
    }
  }
  return model;
}
