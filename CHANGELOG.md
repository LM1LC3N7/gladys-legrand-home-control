# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Bubendorff iDiamant shutters: the NBR, NBO and NBS shutters behind an
  iDiamant gateway (NBG) are offered as shutters (open, close, stop, and the
  position when the module reports one). The Connect button also asks for
  `read_bubendorff` and `write_bubendorff`; an existing authorization keeps
  controlling the Legrand modules, and the status only asks to connect again
  when Bubendorff shutters are seen without `write_bubendorff`. An app without
  the Bubendorff rights falls back to the Home + Control ones. Never tested with
  real Bubendorff shutters.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` (pyatmo, MIT), copied into the image.

### Changed

- Shutter commands (Legrand and Bubendorff) run one at a time per shutter (a
  stop never waits); a command still waiting for the Netatmo request budget
  when Gladys expects the answer is refused and never sent later; a command
  that left without an answer is reported "sent, without confirmation" and
  the state is read again. Behaviour change for the Legrand shutters too: a
  position is refused until a homestatus was read (after a restart), for a
  module missing from the last read, and for a module whose step is 100 (it
  only opens, closes and stops; it used to round to 0 or 100). After a stop,
  the next command waits for the move still in flight.
- A created device keeps all its features after a reconnection or a restart.
- A command is acknowledged without waiting for its states to reach Gladys; an
  empty or missing value is refused instead of being read as 0.

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-15

### Added

- Link of the Legrand Home + Control account with the Gladys "Connect" button
  (OAuth2, the user's own Netatmo app, Home + Control rights `read_magellan`
  and `write_magellan`). The tokens are refreshed before they expire and
  stored out of sight; an expired or revoked authorization shows in the
  connection status.
- Devices for the Céliane with Netatmo and dooxie with Netatmo modules: power
  outlets, mobile sockets, cable outlets, teleruptors, contactors and dry
  contacts (on/off and power), light switches and micromodules (on/off and
  power), dimmers (brightness), each gang of a double switch, roller shutters
  (open, close, stop, and the position when the module has one), energy meters
  (power, per phase for a three-phase meter) and the battery of the remotes.
- States read every minute (configurable), within the Netatmo usage limits;
  commands of a same home sent together and confirmed a few seconds later.
- The reachability of every module on its transport badge.
- "Test the connection" button.

[Unreleased]: https://github.com/LM1LC3N7/gladys-legrand-home-control/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-legrand-home-control/releases/tag/v0.1.1
