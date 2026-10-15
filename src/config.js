// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized. The tokens
// are stored next to it, off-schema (see src/tokens.js).
// -----------------------------------------------------------------------------

import { POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  client_id: '',
  client_secret: '',
  poll_interval: POLL_INTERVAL.default,
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const interval = Number(c.poll_interval);
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  return {
    clientId,
    clientSecret,
    /** The credentials of the Netatmo app are both needed to start an authorization. */
    hasApp: clientId !== '' && clientSecret !== '',
    pollInterval: Number.isFinite(interval)
      ? Math.max(POLL_INTERVAL.min, Math.min(POLL_INTERVAL.max, Math.round(interval)))
      : POLL_INTERVAL.default,
  };
}
