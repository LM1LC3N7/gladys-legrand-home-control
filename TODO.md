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
- No forum topic of its own, ever: never post on the forum from this repo's
  work. Once the ten integrations claimed on 2026-10-15 are published, one
  recap message goes to the general thread (/t/10385), posted by the main
  session.

## Status

- [x] **Milestone 1 — core** (2026-10-15): OAuth2 through the SDK `oauth2`
      field (read_magellan, write_magellan), rotating refresh tokens stored
      off-schema, homesdata + homestatus polling within the Netatmo limits,
      devices for outlets, contactors, relays, lights, dimmers, double
      switches, shutters, meters (three-phase included) and battery remotes,
      batched setstate commands, transport badges, test button, manifest,
      docs en/fr. 66 unit tests against a fake Netatmo; never run against a
      real installation yet.
- [x] **Bubendorff iDiamant shutters** (2026-10-19): NBR, NBO, NBS as
      shutters through the same API, optional Bubendorff rights, invalid_scope
      fallback, shutter command rules (see Decisions). Never tested with real
      Bubendorff shutters.
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
      topic (no forum thread: see Working method).

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
- Bubendorff: the authorization page with the four rights; what an app without
  them answers (`invalid_scope` at the redirect or the exchange, or rights
  silently dropped from the token); homesdata without `read_bubendorff`;
  NBR/NBO/NBS `current_position` and step in practice (always 100?); setstate
  with the NBG as bridge; the favourite position (-2) as a future button.

## Decisions

- Cloud only (`transports: ["cloud"]`): Netatmo exposes no local API.
- Each user creates their own Netatmo app (client ID + secret in the config):
  no shared app, no secret in the image.
- Scopes: `read_magellan write_magellan` (Legrand wiring devices and
  electrical panel), plus `read_bubendorff write_bubendorff` since the
  Bubendorff iDiamant shutters (2026-10-19, a user request). BTicino (mhs1,
  mx) stays out of scope.
- Bubendorff (2026-10-19): only the Legrand rights are required
  (`hasAllScopes`, "read only" unchanged); a token without the Bubendorff
  rights keeps the Legrand control, Bubendorff commands are refused before any
  request while the token is known to lack `write_bubendorff`, and the status
  adds "click Connect again to add Bubendorff" only when Bubendorff devices
  exist. An unknown token scope never warns. `invalid_scope` at the code
  exchange retries once with the Legrand rights only; a callback without a code
  after asking for Bubendorff makes the NEXT Connect ask for the Legrand rights
  only, once (every attempt is a user click: no loop).
- Bubendorff types from pyatmo (MIT, THIRD_PARTY_NOTICES.md): NBG gateway (no
  device), NBR roller, NBO orientable, NBS swing shutters, all `shutter`
  (never `switch`). A position feature only when the status reports a
  `target_position:step` (or `target_position_step`) under 100; at 100 the
  module only opens, closes and stops and `current_position` echoes the last
  command (pyatmo, seen on BTicino). Values: 100 open, 0 close, -1 stop; -2
  (favourite position) is not offered. No guess for unknown `NB*` types
  (Netatmo uses the prefix for other products). Devices are `module:<id>` like
  the Legrand ones; the model reads `Bubendorff <label> (<type>)`, the Legrand
  models are unchanged.
- Shutter commands (both brands, 2026-10-19): serialized per device (a stop
  never waits, and replaces a pending command of the same module in the
  batch); the position step is decided on the last homestatus read (never on
  the values in memory), a position is refused without a read status or with a
  step of 100; a command not sent when the ack is due (4 s) is withdrawn from
  its batch and refused, never sent later; one whose request left without an
  answer is refused as "sent, without confirmation" and the home is read again.
  `NetatmoError.unconfirmed` marks timeouts, cut connections, 5xx and non-JSON
  answers (DNS or refused connections are "not sent"). Other commands keep the
  ack-then-send-later rule. The ack never waits for the states publication.
- Strict command values: null, '' or a boolean are refused (they never stand
  for 0, which closes a shutter).
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
