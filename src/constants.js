// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them), the Netatmo
// Connect endpoints and scopes, and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** The `oauth2` field of the manifest `config_schema` (the Connect button). */
export const OAUTH_FIELD = 'netatmo_account';

/** Home + Control rights: Legrand wiring devices and electrical panel products. */
export const LEGRAND_SCOPES = ['read_magellan', 'write_magellan'];

/** Bubendorff iDiamant with Netatmo rights (the shutters behind an NBG gateway). */
export const BUBENDORFF_SCOPES = ['read_bubendorff', 'write_bubendorff'];

/**
 * The rights the "Connect" button asks for. Only the Legrand ones are required:
 * a token without the Bubendorff rights (linked before they were asked, or an
 * app that does not offer them) keeps controlling the Legrand modules.
 */
export const SCOPES = [...LEGRAND_SCOPES, ...BUBENDORFF_SCOPES];

export const NETATMO = {
  authorizeUrl: 'https://api.netatmo.com/oauth2/authorize',
  tokenUrl: 'https://api.netatmo.com/oauth2/token',
  apiUrl: 'https://api.netatmo.com/api',
};

/**
 * Config keys OUTSIDE the config_schema where the tokens live: free internal
 * storage of the integration, never shown in the UI nor sent to the front.
 */
export const TOKEN_KEYS = {
  ACCESS: 'access_token',
  REFRESH: 'refresh_token',
  EXPIRES_AT: 'token_expires_at',
  CLIENT_ID: 'token_client_id',
  SCOPE: 'token_scope',
};

/** Refresh interval bounds (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 60, max: 3600, default: 60 };

export const LIMITS = {
  // Netatmo allows 50 requests per 10 s and 500 per hour per user, and an app
  // with a single user (the one each Gladys owner creates) 2 per 10 s on
  // average: background requests are spaced, commands may burst a little.
  /** Requests in any window of `burstWindow` ms. */
  burst: 5,
  burstWindow: 10_000,
  /** Minimum delay between two background requests (polls, topology). */
  backgroundSpacing: 5000,
  /** Requests per hour, all kinds. */
  hourly: 400,
  /** Part of the hourly budget the background requests leave to the commands. */
  commandReserve: 50,
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
};

export const TIMINGS = {
  /** Netatmo request timeout. */
  requestTimeout: 15_000,
  /** The access token is refreshed this long before it expires. */
  refreshMargin: 5 * 60_000,
  /** How long an authorization started with "Connect" stays valid. */
  oauthStateTtl: 30 * 60_000,
  /** Commands of a same home within this delay share one setstate request. */
  commandBatch: 150,
  /** A command waits this long for its request, then is acked anyway (queued). */
  commandAck: 4000,
  /** A home is read again this long after a command, to confirm the new states. */
  confirmDelay: 5000,
  /** The homes topology (names, rooms, new modules) is read again this often. */
  topologyRefresh: 6 * 3600_000,
  /** A scan re-reads the topology only if it is older than this. */
  scanFreshness: 30_000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** Pause after a usage limit answered without a Retry-After header. */
  throttlePause: 15 * 60_000,
  /** Longest delay between two attempts after errors. */
  errorBackoffMax: 15 * 60_000,
};
