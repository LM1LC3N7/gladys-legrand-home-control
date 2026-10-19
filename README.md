# gladys-legrand-home-control

[Gladys Assistant](https://gladysassistant.com) external integration for
**Legrand Home + Control**: the Céliane with Netatmo and dooxie with Netatmo
modules behind a Legrand Home + Control gateway (lights, dimmers, outlets,
contactors, roller shutters, energy meters), and the **Bubendorff iDiamant with
Netatmo** shutters (never tested with real Bubendorff shutters). It links the user's account
through the Netatmo Connect API (OAuth2), reads the homes, offers every module
in the Discovery tab and sends the commands back. Unofficial, not affiliated
with Legrand, Bubendorff or Netatmo.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-legrand-home-control`.
> First version, tested against recorded Netatmo answers, not yet on a real
> Home + Control installation. Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-legrand-home-control/issues).
> The existing Gladys Netatmo integration covers the weather station, the
> thermostats and the cameras, not the Home + Control modules.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (LegrandApp) ⇄ src/netatmo.js ⇄ api.netatmo.com
                                   ├─ src/tokens.js     OAuth2 code exchange, rotating refresh
                                   ├─ src/limiter.js    Netatmo request budget
                                   ├─ src/devices.js    homesdata + homestatus -> devices (pure)
                                   ├─ src/states.js     homestatus -> values, reachability (pure)
                                   ├─ src/commands.js   values -> setstate entries (pure)
                                   └─ src/publisher.js  states within 300/min
```

- **Account**: the manifest declares an `oauth2` field. Gladys relays the
  "Connect" button: `onOAuthAuthorizeUrl` builds the Netatmo authorization URL
  (the user's client ID, scopes `read_magellan write_magellan read_bubendorff
write_bubendorff`, an anti-CSRF state), `onOAuthCallback` checks the state
  and exchanges the code. Only the Legrand rights are required: a token without
  the Bubendorff ones keeps the Legrand control, and the status asks to connect
  again only when Bubendorff shutters are seen without `write_bubendorff`. An
  `invalid_scope` answer (an app without the Bubendorff rights) retries the
  exchange once with the Legrand rights; a refused authorization page makes the
  next click ask for them only, once. The tokens
  live in the Gladys config under keys outside the `config_schema` (never
  shown). Netatmo rotates the refresh token at every refresh: refreshes are
  single-flight and saved at once.
- **Reading**: `homesdata` (topology: homes, rooms, modules) every 6 hours or
  on a Discovery scan, `homestatus` per home with a Legrand or iDiamant gateway at the
  configured interval (one minute minimum).
- **Devices**: one per module (MAC-based external ids), each gang of a double
  switch is a device, the phases of a three-phase meter are features. Unknown
  `NL*` types are guessed from the states they report. Bubendorff NBR, NBO and
  NBS are shutters (the NBG gateway is no device), with a position only when
  their `target_position:step` is under 100.
- **Commands**: `onSetValue` -> one `setstate` per home for the commands sent
  within 150 ms (`{ id, bridge, on | brightness | target_position }`); the
  expected state is shown at once and the home is read again 5 s later; the ack
  never waits for the states to reach Gladys. Shutter commands (both brands)
  run one at a time per device (a stop never waits), are withdrawn and refused
  if still waiting for the request budget when the ack is due (never sent late),
  and are reported `sent, without confirmation` when the request left without
  an answer (timeout, 5xx), the home being read again.
- **Limits**: every request goes through a limiter (5 per 10 s, background
  requests 5 s apart, 400 per hour of which 50 kept for commands); a usage
  limit answer pauses everything (Retry-After, 15 min otherwise).

References: the Home + Control and glossary pages of
[dev.netatmo.com](https://dev.netatmo.com/apidocumentation/control), the module
types and shutter values of [pyatmo](https://github.com/jabesq-org/pyatmo)
(MIT, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) and the Home
Assistant `netatmo` integration (Apache-2.0); no code copied.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/netatmo.js` holds Netatmo answers shaped like the real ones;
`test/helpers/fakeNetatmo.js` plays the token endpoint (rotating refresh
tokens), homesdata, homestatus and setstate behind `fetch`. The end-to-end
tests run the real SDK wiring against the SDK's fake Gladys.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0 (see [LICENSE](LICENSE)); third-party notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
