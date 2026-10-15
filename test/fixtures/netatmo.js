// -----------------------------------------------------------------------------
// Netatmo Connect answers shaped like the real ones (Home + Control page and
// glossary of dev.netatmo.com, and the recorded answers of pyatmo): one home
// with a Legrand gateway and its modules, and a home with a thermostat only.
// Ids are made up.
// -----------------------------------------------------------------------------

export const HOME_ID = '66aa00000000000000000001';
export const OTHER_HOME_ID = '66aa00000000000000000002';

export const M = {
  GATEWAY: '70:ee:50:00:00:01',
  OUTLET: '00:04:74:00:00:01:aa:01',
  TELERUPTOR: '00:04:74:00:00:01:aa:02',
  CONTACTOR: '00:04:74:00:00:01:aa:03',
  RADIATOR: '00:04:74:00:00:01:aa:04',
  LIGHT: '00:04:74:00:00:01:aa:05',
  DIMMER: '00:04:74:00:00:01:aa:06',
  DOUBLE: '00:04:74:00:00:01:aa:07',
  SHUTTER: '00:04:74:00:00:01:aa:08',
  LEVEL_SHUTTER: '00:04:74:00:00:01:aa:09',
  METER: '00:04:74:00:00:01:aa:0a',
  THREE_PHASE: '00:04:74:00:00:01:aa:0b',
  ECOMETER: '00:04:74:00:00:01:aa:0c',
  REMOTE: '00:04:74:00:00:01:aa:0d',
  BATTERYLESS: '00:04:74:00:00:01:aa:0e',
  FUTURE: '00:04:74:00:00:01:aa:0f',
  THERMOSTAT_PLUG: '70:ee:50:99:00:01',
  THERMOSTAT: '04:00:00:99:00:02',
};

const bridged = (type, id, name, extra = {}) => ({
  id,
  type,
  name,
  setup_date: 1700000000,
  bridge: M.GATEWAY,
  ...extra,
});

export const HOMESDATA = {
  status: 'ok',
  time_server: 1760000000,
  body: {
    homes: [
      {
        id: HOME_ID,
        name: 'Maison',
        altitude: 35,
        coordinates: [2.35, 48.85],
        country: 'FR',
        timezone: 'Europe/Paris',
        rooms: [
          { id: '100', name: 'Salon', type: 'livingroom', module_ids: [M.OUTLET, M.DIMMER] },
          { id: '200', name: 'Cuisine', type: 'kitchen', module_ids: [M.LIGHT, M.SHUTTER] },
          { id: '300', name: 'Couloir', type: 'corridor', module_ids: [M.TELERUPTOR] },
        ],
        modules: [
          {
            id: M.GATEWAY,
            type: 'NLG',
            name: 'Passerelle',
            setup_date: 1700000000,
            room_id: '300',
            modules_bridged: [M.OUTLET, M.TELERUPTOR, M.DOUBLE, `${M.DOUBLE}#1`, `${M.DOUBLE}#2`],
          },
          bridged('NLP', M.OUTLET, 'Prise salon', { room_id: '100', appliance_type: 'other' }),
          bridged('NLPT', M.TELERUPTOR, 'Télérupteur couloir', {
            room_id: '300',
            appliance_type: 'light',
          }),
          bridged('NLPO', M.CONTACTOR, 'Contacteur chauffe-eau', {
            appliance_type: 'water_heater',
          }),
          bridged('NLC', M.RADIATOR, 'Radiateur chambre', { appliance_type: 'radiator' }),
          bridged('NLL', M.LIGHT, 'Plafonnier cuisine', { room_id: '200' }),
          bridged('NLF', M.DIMMER, 'Variateur salon', { room_id: '100' }),
          bridged('NLIS', M.DOUBLE, ''),
          bridged('NLIS', `${M.DOUBLE}#1`, 'Applique gauche', { room_id: '100' }),
          bridged('NLIS', `${M.DOUBLE}#2`, 'Applique droite', { room_id: '100' }),
          bridged('NLV', M.SHUTTER, 'Volet cuisine', {
            room_id: '200',
            appliance_type: 'rolling_shutter',
          }),
          bridged('NLLV', M.LEVEL_SHUTTER, 'Volet salon', { appliance_type: 'rolling_shutter' }),
          bridged('NLPC', M.METER, 'Compteur tableau'),
          bridged('NLY', M.THREE_PHASE, 'Compteur triphasé'),
          bridged('NLY', `${M.THREE_PHASE}#1`, 'NLY 1'),
          bridged('NLY', `${M.THREE_PHASE}#2`, 'NLY 2'),
          bridged('NLY', `${M.THREE_PHASE}#3`, 'NLY 3'),
          { id: M.ECOMETER, type: 'NLE', name: 'Écocompteur', setup_date: 1700000000 },
          { id: `${M.ECOMETER}#0`, type: 'NLE', name: 'Ligne 1', bridge: M.ECOMETER },
          bridged('NLT', M.REMOTE, 'Commande sans fil'),
          bridged('NLAO', M.BATTERYLESS, 'Interrupteur sans pile'),
          bridged('NLZZ', M.FUTURE, 'Module futur'),
          {
            id: M.THERMOSTAT_PLUG,
            type: 'NAPlug',
            name: 'Relais',
            modules_bridged: [M.THERMOSTAT],
          },
          { id: M.THERMOSTAT, type: 'NATherm1', name: 'Thermostat', bridge: M.THERMOSTAT_PLUG },
        ],
        temperature_control_mode: 'heating',
        therm_mode: 'schedule',
      },
      {
        id: OTHER_HOME_ID,
        name: 'Chalet',
        rooms: [],
        modules: [{ id: '70:ee:50:99:99:01', type: 'NAPlug', name: 'Relais chalet' }],
      },
    ],
    user: { email: 'someone@example.com', language: 'fr-FR', locale: 'fr-FR' },
  },
};

const live = (id, type, extra = {}) => ({
  id,
  type,
  firmware_revision: 70,
  last_seen: 1760000000,
  reachable: true,
  bridge: M.GATEWAY,
  ...extra,
});

export const HOMESTATUS = {
  status: 'ok',
  time_server: 1760000000,
  body: {
    home: {
      id: HOME_ID,
      modules: [
        {
          id: M.GATEWAY,
          type: 'NLG',
          offload: false,
          firmware_revision: 211,
          wifi_strength: 51,
          reachable: true,
        },
        live(M.OUTLET, 'NLP', { on: true, offload: false, power: 120 }),
        live(M.TELERUPTOR, 'NLPT', { on: false, power: 0 }),
        live(M.CONTACTOR, 'NLPO', {
          on: true,
          contactor_mode: 'auto',
          offload: false,
          power: 2100,
        }),
        live(M.RADIATOR, 'NLC', { on: true, power: 0 }),
        live(M.LIGHT, 'NLL', { on: true, power: 60 }),
        live(M.DIMMER, 'NLF', { on: true, brightness: 63, power: 25 }),
        live(M.DOUBLE, 'NLIS'),
        { id: `${M.DOUBLE}#1`, type: 'NLIS', on: true, power: 10, bridge: M.GATEWAY },
        { id: `${M.DOUBLE}#2`, type: 'NLIS', on: false, power: 0, bridge: M.GATEWAY },
        live(M.SHUTTER, 'NLV', {
          current_position: 0,
          target_position: 0,
          'target_position:step': 100,
        }),
        live(M.LEVEL_SHUTTER, 'NLLV', {
          current_position: 40,
          target_position: 40,
          'target_position:step': 1,
        }),
        live(M.METER, 'NLPC', { power: 476 }),
        live(M.THREE_PHASE, 'NLY', { power: 160 }),
        { id: `${M.THREE_PHASE}#1`, type: 'NLY', power: 0, bridge: M.GATEWAY },
        { id: `${M.THREE_PHASE}#2`, type: 'NLY', power: 64, bridge: M.GATEWAY },
        { id: `${M.THREE_PHASE}#3`, type: 'NLY', power: 96, bridge: M.GATEWAY },
        { id: M.ECOMETER, type: 'NLE', firmware_revision: 14, wifi_strength: 38 },
        { id: `${M.ECOMETER}#0`, type: 'NLE', bridge: M.ECOMETER },
        live(M.REMOTE, 'NLT', { battery_state: 'high', battery_level: 3200 }),
        live(M.FUTURE, 'NLZZ', { on: false, power: 5 }),
      ],
      rooms: [],
    },
    errors: [],
  },
};

/** The token endpoint answer (a refresh answers the same shape). */
export const tokenAnswer = (n) => ({
  access_token: `66aa0000000000000000beef|access-${n}`,
  refresh_token: `66aa0000000000000000beef|refresh-${n}`,
  scope: ['read_magellan', 'write_magellan'],
  expires_in: 10800,
  expire_in: 10800,
});
