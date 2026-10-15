// -----------------------------------------------------------------------------
// The Home + Control module types (the Netatmo `type` field) and what they
// become in Gladys (pure). Sources: the Home + Control page of the Netatmo
// Connect documentation (which type reports or accepts which state) and the
// type list of pyatmo (MIT).
// -----------------------------------------------------------------------------

export const KINDS = {
  /** The gateway (NLG): no state of its own, its reachability is its modules'. */
  GATEWAY: 'gateway',
  /** On/off: outlets, cable outlets, teleruptors, contactors, dry contacts. */
  SWITCH: 'switch',
  /** On/off light switches and micromodules. */
  LIGHT: 'light',
  /** Lights with a brightness. */
  DIMMER: 'dimmer',
  /** Roller shutters: open, close, stop, and a position when the module has one. */
  SHUTTER: 'shutter',
  /** Energy meters: the power drawn. */
  METER: 'meter',
  /** Battery remotes: the battery level (their presses only reach webhooks). */
  REMOTE: 'remote',
  /** Known, nothing to show in Gladys (yet). */
  IGNORED: 'ignored',
};

const K = KINDS;

/**
 * type -> { kind, label, power (reports its power), position (accepts any
 * position), phases (its `#n` sub-entries are phases of the same meter) }.
 */
export const MODULE_TYPES = {
  NLG: { kind: K.GATEWAY, label: 'Gateway' },
  NLGS: { kind: K.GATEWAY, label: 'Standalone DIN gateway' },

  NLP: { kind: K.SWITCH, label: 'Power outlet', power: true },
  NLPM: { kind: K.SWITCH, label: 'Mobile socket', power: true },
  NLPBS: { kind: K.SWITCH, label: 'British standard outlet' },
  NLC: { kind: K.SWITCH, label: 'Cable outlet', power: true },
  NLUP: { kind: K.SWITCH, label: 'Power outlet' },
  NLUI: { kind: K.SWITCH, label: 'In-wall switch' },
  NLPT: { kind: K.SWITCH, label: 'Teleruptor', power: true },
  NLPO: { kind: K.SWITCH, label: 'Contactor', power: true },
  NLPD: { kind: K.SWITCH, label: 'Dry contact', power: true },

  NLL: { kind: K.LIGHT, label: 'Light switch with neutral', power: true },
  NLM: { kind: K.LIGHT, label: 'Light micromodule', power: true },
  NLIS: { kind: K.LIGHT, label: 'Double light switch', power: true },

  NLF: { kind: K.DIMMER, label: 'Dimmer light switch', power: true },
  NLFN: { kind: K.DIMMER, label: 'Dimmer with neutral', power: true },
  NLFE: { kind: K.DIMMER, label: 'Dimmer light switch evolution', power: true },
  NLUF: { kind: K.DIMMER, label: 'In-wall dimmer' },
  NLUO: { kind: K.DIMMER, label: 'Plug-in dimmer' },
  Z3L: { kind: K.DIMMER, label: 'Zigbee light', power: true },

  NLV: { kind: K.SHUTTER, label: 'Roller shutter switch' },
  NLLV: { kind: K.SHUTTER, label: 'Roller shutter switch with level', position: true },
  NLLM: { kind: K.SHUTTER, label: 'Roller shutter' },
  NLIV: { kind: K.SHUTTER, label: 'Shutter switch' },
  Z3V: { kind: K.SHUTTER, label: 'Zigbee window covering' },

  NLPC: { kind: K.METER, label: 'DIN energy meter', power: true },
  NLPS: { kind: K.METER, label: 'Smart load shedder', power: true },
  NLY: { kind: K.METER, label: 'Three-phase energy meter', power: true, phases: true },
  // The ecometer reports no power in homestatus: its lines need getmeasure.
  NLE: { kind: K.IGNORED, label: 'Ecometer' },

  NLT: { kind: K.REMOTE, label: 'Remote control' },
  NLD: { kind: K.REMOTE, label: 'Double on/off remote' },
  NLDP: { kind: K.REMOTE, label: 'Pocket remote' },

  NLAO: { kind: K.IGNORED, label: 'Batteryless switch' },
  NLAS: { kind: K.IGNORED, label: 'Batteryless scene switch' },
  NLAV: { kind: K.IGNORED, label: 'Batteryless shutter switch' },
  NLDD: { kind: K.IGNORED, label: 'Dimmer remote' },
  NLLF: { kind: K.IGNORED, label: 'Centralized ventilation control' },
  NLJ: { kind: K.IGNORED, label: 'Garage door opener' },
  NLTS: { kind: K.IGNORED, label: 'Motion sensor' },
};

/** Types of the Legrand family whose unknown members are guessed from their states. */
const FAMILY = /^(NL|Z3)/;

/** The separator of the per-gang entries of a module: `<module id>#<n>`. */
export const SUB_SEPARATOR = '#';

export const isSubModule = (id) => String(id).includes(SUB_SEPARATOR);
export const parentOf = (id) => String(id).split(SUB_SEPARATOR)[0];

const has = (status, key) => status && status[key] !== undefined && status[key] !== null;

/**
 * What a module is: its catalog entry, or a guess from the states it reports
 * for an unknown type of the family. `null`: not a Home + Control module.
 */
export function describe(type, status) {
  const known = MODULE_TYPES[type];
  if (known) {
    return known;
  }
  if (!FAMILY.test(String(type ?? ''))) {
    return null;
  }
  if (has(status, 'brightness')) {
    return { kind: K.DIMMER, label: type, power: has(status, 'power') };
  }
  if (has(status, 'target_position') || has(status, 'current_position')) {
    return { kind: K.SHUTTER, label: type };
  }
  if (has(status, 'on')) {
    return { kind: K.SWITCH, label: type, power: has(status, 'power') };
  }
  if (has(status, 'power')) {
    return { kind: K.METER, label: type, power: true };
  }
  return { kind: K.IGNORED, label: type };
}
