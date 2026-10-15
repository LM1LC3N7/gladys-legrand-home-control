# TODO — Legrand Home + Control v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).

## Status

- [x] **Milestone 1 — core** (2026-10-15): OAuth2 through the SDK `oauth2`
      field (read_magellan, write_magellan), rotating refresh tokens stored
      off-schema, homesdata + homestatus polling within the Netatmo limits,
      devices for outlets, contactors, relays, lights, dimmers, double
      switches, shutters, meters (three-phase included) and battery remotes,
      batched setstate commands, transport badges, test button, manifest,
      docs en/fr. 66 unit tests against a fake Netatmo; never run against a
      real installation yet.
- [ ] **Milestone 2 — real installation**: a tester with a Home + Control
      gateway; record their homesdata/homestatus (ids anonymized) as fixtures;
      check the points listed below; fix what differs.
- [ ] **Milestone 3 — webhooks and more modules**: Gladys Plus webhooks
      (`webhooks/v1` registration, NLG events used as a refresh trigger, never
      as data); remote button presses as a scene trigger; NLC cable outlets in
      pilot-wire mode (`therm_setpoint_fp`: comfort, eco, frost guard, off);
      NLLF ventilation (fan speed 1/2); NLJ garage door; NLPO contactor mode;
      energy history (getmeasure) for NLE ecometer lines and the meters.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, forum thread in Développement.

## To check on a real installation

- The redirect URI Gladys shows is accepted by the Netatmo app settings, and
  the authorization page shows the Home + Control rights.
- The token answer carries `scope` (used to warn about a missing
  write_magellan) and the refresh token rotates as documented.
- setstate with `bridge` for every module type; the NLIS gangs (`<id>#1`)
  accept `on`; a dimmer accepts `brightness` alone while off (does it turn on?).
- Shutters: NLV `current_position` while moving and after a stop; NLLV
  intermediate positions and `target_position:step`; Z3V.
- Which modules really report `power` (NLUI, NLUP, NLPBS, NLUF, NLUO, Z3L are
  guessed from pyatmo, not from the documentation).
- The per-app limit (2 requests per 10 s with one user) in practice, and the
  error codes when it is exceeded (403 code 26 or 429 code 28/29).
- The `errors` of homestatus when the gateway is offline (code 6 per module?).

## Decisions

- Cloud only (`transports: ["cloud"]`): Netatmo exposes no local API.
- Each user creates their own Netatmo app (client ID + secret in the config):
  no shared app, no secret in the image.
- Scopes: `read_magellan write_magellan` only (Legrand wiring devices and
  electrical panel). BTicino (mhs1, mx) and Bubendorff are out of scope.
- One Gladys device per module; NLIS gangs are devices of their own, NLY
  phases are features of the meter. The gateway is no device: its
  reachability is its modules'.
- A switch whose `appliance_type` is `light` is a light. An NLC driving a
  pilot-wire radiator (`appliance_type: radiator`) only shows its power until
  pilot-wire modes are supported.
- Unknown `NL*`/`Z3*` types are guessed from the states they report
  (brightness -> dimmer, positions -> shutter, on -> switch, power -> meter).
- Polling by the integration's own timer (not `should_poll`): one homestatus
  per home per interval (60 s default), the topology every 6 h or on a scan.
- Commands of a same home within 150 ms share one setstate; a command waiting
  for the request budget is acked after 4 s and sent when it can; the home is
  read again 5 s after a command.
- States are only sent for the devices the user created; the last value read
  is sent at creation.
- A refused refresh token stops every request until the user connects again
  or changes the app credentials. A changed client ID wipes the stored tokens.
