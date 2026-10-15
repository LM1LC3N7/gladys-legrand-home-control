# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-legrand-home-control/commits/main
