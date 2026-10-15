# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It links
the user's Legrand Home + Control account (Céliane with Netatmo, dooxie with
Netatmo) through the **Netatmo Connect API** with OAuth2, polls the homes and
turns the modules into Gladys devices it can control. Unofficial, not
affiliated with Legrand or Netatmo.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          LegrandApp: OAuth2 flow, poll loop, devices, states,
                    transport badges, batched commands, test button
src/tokens.js       OAuth2 tokens: code exchange, rotating refresh, storage
src/netatmo.js      the only network access: token endpoint, homesdata,
                    homestatus, setstate, error classification
src/limiter.js      the Netatmo request budget (burst, spacing, hourly)
src/catalog.js      Netatmo module types -> kinds (pure)
src/devices.js      homesdata + homestatus -> Gladys devices + routes (pure)
src/states.js       homestatus -> feature values, reachability (pure)
src/commands.js     Gladys values -> setstate module entries (pure)
src/publisher.js    states within the Gladys rate limit
src/config.js       config_schema normalized
src/constants.js    manifest keys, scopes, endpoints, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      Netatmo answers shaped like the real ones
test/helpers/       a fake Netatmo behind `fetch`; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `module:<module id without colons>`
  (`#n` gangs -> `-n`), features `on`, `brightness`, `power`, `power-<n>`,
  `state`, `position`, `battery`. Never change how they are built.
- Manifest keys (`netatmo_account`, `client_id`, `client_secret`,
  `poll_interval`, `test_connection`) and the off-schema token keys
  (`access_token`, `refresh_token`, `token_expires_at`, `token_client_id`,
  `token_scope`) are frozen: users store them.
- **Netatmo rotates the refresh token**: every refresh invalidates the previous
  one. Refreshes are single-flight, saved at once, and the tokens in memory win
  over the stored ones for the same client ID. Never refresh in parallel.
- **Netatmo limits**: 50 requests per 10 s and 500 per hour per user, and an
  app with one user about 2 per 10 s. Every API request goes through
  `RequestLimiter`; background requests are spaced by 5 s; polls are one minute
  minimum. Never add a request outside `NetatmoClient`.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable. The integration only talks to `api.netatmo.com` (cloud).
- Gladys rate limits: 300 states/min (`StatePublisher` keeps 250).
- Never log or put in a status message a token, the client secret or a code.
- Tests never touch the network: `test/helpers/fakeNetatmo.js` plays Netatmo.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]`;
  versions belong to the Release workflow (never edit them by hand).
