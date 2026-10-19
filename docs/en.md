# Legrand Home + Control

Control the **Céliane with Netatmo** and **dooxie with Netatmo** modules of
your Legrand **Home + Control** gateway from Gladys: lights and dimmers, power
outlets, contactors, roller shutters and energy meters. The integration talks
to the Netatmo cloud (the service behind the Home + Control app) with the
official Netatmo Connect API, on your behalf. Unofficial integration, not
affiliated with Legrand or Netatmo.

> **Development version (0.1).** Developed against the Netatmo documentation
> and recorded answers, not yet tested on a real installation. Your feedback
> is welcome on the GitHub repository.

## What you get

| Module                                                              | In Gladys                                   |
| ------------------------------------------------------------------- | ------------------------------------------- |
| Power outlet, mobile socket, cable outlet (NLP, NLPM, NLC)          | a switch: on/off and power (W)              |
| Teleruptor, contactor, dry contact (NLPT, NLPO, NLPD)               | a switch (a light when it drives a light)   |
| Light switch, micromodule, double switch (NLL, NLM, NLIS)           | a light: on/off and power (one per gang)    |
| Dimmer (NLF, NLFN, NLFE)                                            | a light: on/off, brightness and power       |
| Roller shutter switch (NLV, NLLV), Zigbee covering (Z3V)            | a shutter: open, close, stop (and position) |
| DIN energy meter, load shedder, three-phase meter (NLPC, NLPS, NLY) | power drawn (per phase for NLY)             |
| Remote control (NLT, NLD)                                           | battery level                               |
| Bubendorff iDiamant shutter (NBR, NBO, NBS)                         | a shutter: open, close, stop (and position) |

The position of a shutter is offered for the modules that accept any position
(NLLV, and the shutters that report a step under 100); the others open, close
and stop. Each device shows on its badge whether the module answers.

## Bubendorff iDiamant with Netatmo shutters

The Bubendorff shutters behind an iDiamant gateway (NBG) go through the same
Netatmo Connect API: they show up in Discovery as **shutters** (never as
switches), with open, close and stop, and a position only when the module
reports one (most iDiamant shutters only open, close and stop). The favourite
position of the Bubendorff remote is not offered yet.

**Never tested with real Bubendorff shutters**: developed from the answers
recorded by pyatmo. Your feedback is welcome.

The **Connect** button now also asks for the Bubendorff rights
(`read_bubendorff`, `write_bubendorff`). If you connected before this version,
nothing changes for your Legrand modules; when Bubendorff shutters are found
without the `write_bubendorff` right, the status asks you to click **Connect**
again to add Bubendorff. If your Netatmo app does not offer these rights,
the integration falls back to the Home + Control rights alone (at once when
Netatmo refuses them while linking, or at the next click after a refused
authorization page).

A shutter command is never sent late: one at a time per shutter (a stop never
waits), refused if Netatmo could not take it within four seconds, and
reported as **sent, without confirmation** when it left without an answer,
the state being read again a few seconds later.

Not yet: cable outlets in pilot-wire mode (radiators: their power only),
ventilation (NLLF), garage door (NLJ), the ecometer lines (NLE), the button
presses of the remotes, energy history. They are planned.

## Installation

You need a **Netatmo app** of your own (free, five minutes): it gives the
integration the right to use the API with your account.

1. Go to [dev.netatmo.com](https://dev.netatmo.com/apps/createanapp) and sign
   in with the account of the **Home + Control** (or **Bubendorff iDiamant**)
   app.
2. **Create an app**: any name and description (e.g. "Gladys"), your name and
   email as data protection contact.
3. In the Gladys configuration of the integration, copy the **redirect URI**
   Gladys shows for the **Connect** button, and paste it in the **Redirect
   URI** field of the Netatmo app. Save the app.
4. Copy the **client ID** and the **client secret** of the app into the Gladys
   configuration, and **save**.
5. Click **Connect**: Netatmo asks you to sign in and to accept the Home +
   Control rights (`read_magellan`, `write_magellan`) and, for the
   Bubendorff shutters, `read_bubendorff` and `write_bubendorff`. You come back
   to Gladys, connected.
6. Open the **Discovery** tab: your modules are there, add the ones you want.

**Test the connection** shows how many homes and devices were found.

## Options

| Option           | Default | Purpose                                                        |
| ---------------- | ------- | -------------------------------------------------------------- |
| Refresh interval | 60 s    | how often the states are read (one minute minimum, max 1 hour) |

A command is sent at once and the state is read again a few seconds later.
Netatmo limits the requests (500 per hour per user): the integration spaces
them, sends the commands of a same moment together and pauses when Netatmo
asks it to. With several homes or many commands, a longer interval is safer.

## Troubleshooting

- **"Netatmo refused the authorization"**: the authorization expired or was
  revoked (from the Netatmo account), or the client secret is wrong. Check the
  client ID and the client secret, save, then click **Connect** again.
- **The Connect page shows an error**: the redirect URI of the Netatmo app is
  not exactly the one Gladys shows (copy it again, without a space).
- **"Read only"**: the Home + Control rights were not all accepted: click
  **Connect** again and accept them.
- **"click Connect again to add Bubendorff"**: your authorization predates the
  Bubendorff rights. Click **Connect** and accept them; the Legrand modules
  keep working meanwhile.
- **"usage limit reached"**: Netatmo asked to slow down; the integration
  retries by itself. Increase the refresh interval if it comes back.
- **A module is missing**: the logs list the modules the integration cannot
  show yet; **Test the connection** counts them.
- **A device shows "unreachable"**: the module or the gateway does not answer
  Netatmo (power cut, Wi-Fi of the gateway).

## Privacy

The integration only talks to `api.netatmo.com`, with your own Netatmo app.
The client secret and the tokens are stored by Gladys and never appear in the
logs. Nothing goes through Gladys Plus.
