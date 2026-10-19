// -----------------------------------------------------------------------------
// The OAuth2 tokens of the Netatmo account: obtained when the user clicks
// "Connect" (authorization code), refreshed before they expire, stored in the
// Gladys config under keys OUTSIDE the config_schema (never shown, never sent
// to the front).
//
// Netatmo rotates the refresh token: every refresh returns a new one and the
// previous one stops working at once. So refreshes run one at a time, the new
// tokens are saved right away, and the tokens in memory win over the stored
// ones for the same app (a save may have failed while Gladys was unreachable).
// -----------------------------------------------------------------------------

import { LEGRAND_SCOPES, SCOPES, TIMINGS, TOKEN_KEYS } from './constants.js';
import { ERROR_KINDS, NetatmoError, requestToken } from './netatmo.js';

/** The tokens stored in the config, or null. */
export function storedTokens(raw) {
  const refreshToken = raw?.[TOKEN_KEYS.REFRESH];
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    return null;
  }
  return {
    accessToken: String(raw[TOKEN_KEYS.ACCESS] ?? ''),
    refreshToken,
    expiresAt: Number(raw[TOKEN_KEYS.EXPIRES_AT]) || 0,
    clientId: String(raw[TOKEN_KEYS.CLIENT_ID] ?? ''),
    scope: String(raw[TOKEN_KEYS.SCOPE] ?? '')
      .split(' ')
      .filter(Boolean),
  };
}

const notConnected = () =>
  new NetatmoError('no Netatmo account connected', { kind: ERROR_KINDS.GRANT });

export class TokenManager {
  constructor({ gladys, fetch: fetchFn, logger, now = Date.now, timeout }) {
    this.gladys = gladys;
    this.fetch = fetchFn;
    this.logger = logger;
    this.now = now;
    this.timeout = timeout;
    /** { accessToken, refreshToken, expiresAt, clientId, scope[] } */
    this.state = null;
    this.app = { clientId: '', clientSecret: '' };
    /** The last refusal of the refresh token: no retry until the app or the account changes. */
    this.refused = undefined;
    this.refreshing = undefined;
    this.unsaved = false;
  }

  /**
   * Loads the tokens at start (and on every configuration change). Returns
   * true when stored tokens of another app had to be forgotten.
   */
  load(raw, { clientId, clientSecret }) {
    const appChanged = clientId !== this.app.clientId || clientSecret !== this.app.clientSecret;
    this.app = { clientId, clientSecret };
    if (appChanged) {
      this.refused = undefined;
    }
    if (this.state && this.state.clientId === clientId) {
      return false;
    }
    const stored = storedTokens(raw);
    if (stored && (stored.clientId === '' || stored.clientId === clientId)) {
      this.state = { ...stored, clientId };
      return false;
    }
    // Tokens of another Netatmo app (the client ID changed): they are useless.
    this.state = null;
    return stored !== null;
  }

  get connected() {
    return this.state !== null;
  }

  get scope() {
    return this.state?.scope ?? [];
  }

  /**
   * Whether the authorization covers every Home + Control (Legrand) right
   * (unknown scope: assumed). The Bubendorff rights are optional, see `lacks`.
   */
  get hasAllScopes() {
    const scope = this.scope;
    return scope.length === 0 || LEGRAND_SCOPES.every((s) => scope.includes(s));
  }

  /** Whether the authorization is known to miss this right (unknown scope: never). */
  lacks(right) {
    const scope = this.scope;
    return scope.length > 0 && !scope.includes(right);
  }

  /** A valid access token, refreshed when it expires within the margin. */
  async accessToken() {
    if (this.refused) {
      throw this.refused;
    }
    if (!this.state) {
      throw notConnected();
    }
    if (this.now() >= this.state.expiresAt - TIMINGS.refreshMargin) {
      await this.refresh(this.state.accessToken);
    }
    if (!this.state) {
      throw notConnected();
    }
    return this.state.accessToken;
  }

  /**
   * Refreshes the tokens, once for all the concurrent callers. `refusedToken`:
   * the access token Netatmo refused; nothing is done when it was already
   * replaced meanwhile.
   */
  refresh(refusedToken) {
    if (refusedToken !== undefined && this.state && this.state.accessToken !== refusedToken) {
      return Promise.resolve();
    }
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  async doRefresh() {
    const state = this.state;
    if (this.refused) {
      throw this.refused;
    }
    if (!state) {
      throw notConnected();
    }
    let tokens;
    try {
      tokens = await requestToken(
        this.fetch,
        {
          grant_type: 'refresh_token',
          refresh_token: state.refreshToken,
          client_id: this.app.clientId,
          client_secret: this.app.clientSecret,
        },
        { timeout: this.timeout },
      );
    } catch (err) {
      if (err.kind === ERROR_KINDS.GRANT && this.state === state) {
        this.refused = err;
      }
      throw err;
    }
    if (this.state !== state) {
      // The user connected again meanwhile: those tokens are the newest.
      return;
    }
    this.state = {
      ...state,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? state.refreshToken,
      expiresAt: this.now() + tokens.expiresIn * 1000,
      scope: tokens.scope.length > 0 ? tokens.scope : state.scope,
    };
    this.logger?.debug('Netatmo access token refreshed');
    await this.save();
  }

  /**
   * Exchanges the authorization code the provider sent back for tokens. When
   * Netatmo answers `invalid_scope` (an app without the Bubendorff rights), the
   * exchange is tried once more with the Legrand rights only, never more.
   */
  async exchange(code, redirectUri, scopes = SCOPES) {
    const ask = (list) =>
      requestToken(
        this.fetch,
        {
          grant_type: 'authorization_code',
          client_id: this.app.clientId,
          client_secret: this.app.clientSecret,
          code,
          redirect_uri: redirectUri,
          scope: list.join(' '),
        },
        { timeout: this.timeout },
      );
    let tokens;
    try {
      tokens = await ask(scopes);
    } catch (err) {
      const narrower = scopes.length > LEGRAND_SCOPES.length;
      if (err.kind !== ERROR_KINDS.SCOPE || !narrower) {
        throw err;
      }
      this.logger?.info(
        'Netatmo refused the Bubendorff rights: linking with the Legrand ones only',
      );
      tokens = await ask(LEGRAND_SCOPES);
    }
    if (!tokens.refreshToken) {
      throw new NetatmoError('Netatmo sent no refresh token', { kind: ERROR_KINDS.API });
    }
    this.refused = undefined;
    this.state = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: this.now() + tokens.expiresIn * 1000,
      clientId: this.app.clientId,
      scope: tokens.scope,
    };
    await this.save();
    return this.state;
  }

  /** Forgets the tokens (they belong to another app), in memory and in the config. */
  async forget() {
    this.state = null;
    await this.save();
  }

  /** Writes the tokens in the config; a failure keeps them in memory and is retried. */
  async save() {
    const s = this.state;
    const values = s
      ? {
          [TOKEN_KEYS.ACCESS]: s.accessToken,
          [TOKEN_KEYS.REFRESH]: s.refreshToken,
          [TOKEN_KEYS.EXPIRES_AT]: s.expiresAt,
          [TOKEN_KEYS.CLIENT_ID]: s.clientId,
          [TOKEN_KEYS.SCOPE]: s.scope.join(' '),
        }
      : Object.fromEntries(Object.values(TOKEN_KEYS).map((k) => [k, '']));
    try {
      await this.gladys.setConfig(values);
      this.unsaved = false;
    } catch (err) {
      this.unsaved = true;
      this.logger?.warn(`Saving the Netatmo tokens failed, kept in memory: ${err.message}`);
    }
  }

  /** Retries a failed save. */
  async flush() {
    if (this.unsaved) {
      await this.save();
    }
  }
}
