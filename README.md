# gladys-legrand-home-control

[Gladys Assistant](https://gladysassistant.com) external integration for
**Legrand Home + Control**: the Céliane with Netatmo and dooxie with Netatmo
modules behind a Legrand Home + Control gateway (lights, dimmers, outlets,
contactors, roller shutters, energy meters). It links the user's account
through the Netatmo Connect API (OAuth2), reads the homes, offers every module
in the Discovery tab and sends the commands back. Unofficial, not affiliated
with Legrand or Netatmo.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet, not tested on a real
> installation yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/159).
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
  (the user's client ID, scopes `read_magellan write_magellan`, an anti-CSRF
  state), `onOAuthCallback` checks the state and exchanges the code. The tokens
  live in the Gladys config under keys outside the `config_schema` (never
  shown). Netatmo rotates the refresh token at every refresh: refreshes are
  single-flight and saved at once.
- **Reading**: `homesdata` (topology: homes, rooms, modules) every 6 hours or
  on a Discovery scan, `homestatus` per home with a Legrand gateway at the
  configured interval (one minute minimum).
- **Devices**: one per module (MAC-based external ids), each gang of a double
  switch is a device, the phases of a three-phase meter are features. Unknown
  `NL*` types are guessed from the states they report.
- **Commands**: `onSetValue` -> one `setstate` per home for the commands sent
  within 150 ms (`{ id, bridge, on | brightness | target_position }`); the
  expected state is shown at once and the home is read again 5 s later.
- **Limits**: every request goes through a limiter (5 per 10 s, background
  requests 5 s apart, 400 per hour of which 50 kept for commands); a usage
  limit answer pauses everything (Retry-After, 15 min otherwise).

References: the Home + Control and glossary pages of
[dev.netatmo.com](https://dev.netatmo.com/apidocumentation/control), the module
types of [pyatmo](https://github.com/jabesq-org/pyatmo) (MIT) and the Home
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
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0.
