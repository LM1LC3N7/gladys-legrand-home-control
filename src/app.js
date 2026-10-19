// -----------------------------------------------------------------------------
// The integration: the OAuth2 link of the Netatmo account, the polling of the
// homes (homesdata, homestatus), the Gladys devices built from them, their
// states and transport badges, and the commands sent back (setstate).
// index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  MODULE_ERRORS,
  NOTHING_TO_MODIFY,
  commandFields,
  expectedStates,
  isShutterCommand,
  isStop,
  moduleEntry,
} from './commands.js';
import { BRANDS, brandOf } from './catalog.js';
import { normalizeConfig } from './config.js';
import { LEGRAND_SCOPES, OAUTH_FIELD, SCOPES, TIMINGS } from './constants.js';
import { FEATURES, PARAMS, buildModel, mergeSeen } from './devices.js';
import { T, join } from './i18n.js';
import { PRIORITY, RequestLimiter } from './limiter.js';
import { ERROR_KINDS, NetatmoClient, authorizeUrl } from './netatmo.js';
import { StatePublisher } from './publisher.js';
import { readStates } from './states.js';
import { TokenManager } from './tokens.js';

const reasonOf = (err) => String(err?.message ?? err).slice(0, 200);

/** Returned by `within` when the delay ran out first. */
const LATE = Symbol('late');

/** What the user reads when a command fails on the Netatmo side. */
function commandFailure(err) {
  if (err?.unconfirmed) {
    return `sent, without confirmation (${reasonOf(err)}): the state is read again in a few seconds`;
  }
  switch (err?.kind) {
    case ERROR_KINDS.GRANT:
      return 'Netatmo refused the authorization: click Connect again in the configuration';
    case ERROR_KINDS.SCOPE:
      return 'the authorization lacks the write rights (write_magellan, or write_bubendorff for the Bubendorff shutters): click Connect again in the configuration';
    case ERROR_KINDS.THROTTLED:
      return 'Netatmo usage limit reached, try again later';
    case ERROR_KINDS.NETWORK:
      return 'Netatmo is unreachable';
    default:
      return reasonOf(err);
  }
}

export class LegrandApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'legrand-home-control' }),
    fetch: fetchFn = globalThis.fetch,
    now = Date.now,
    timers = globalThis,
    randomId = randomUUID,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.randomId = randomId;
    this.config = normalizeConfig();
    this.limiter = new RequestLimiter({ now, timers });
    this.tokens = new TokenManager({ gladys, fetch: fetchFn, logger, now });
    this.client = new NetatmoClient({ fetch: fetchFn, tokens: this.tokens, limiter: this.limiter });
    this.publisher = new StatePublisher({ gladys, logger, now });
    this.resetAccount();
    /** feature ids of the devices the user created */
    this.created = new Set();
    /** deviceId -> transport last published */
    this.transports = new Map();
    /** OAuth2 state -> { expiresAt, redirectUri } */
    this.oauthStates = new Map();
    /** homeId -> { modules: Map(moduleId -> entry), waiters } (commands being batched) */
    this.batches = new Map();
    this.confirmTimers = new Map();
    /** deviceId -> settles when the last shutter command of the device is answered */
    this.shutterQueue = new Map();
    /** One-shot: the next Connect asks for the Legrand rights only (an app without Bubendorff). */
    this.legrandOnlyNext = false;
    this.pollTimer = undefined;
    this.running = undefined;
    this.rerun = false;
    this.generation = 0;
    this.failures = 0;
    this.linkDown = false;
    this.lastStatus = undefined;
    this.warned = new Set();
  }

  /** Forgets what was read from the account (another account may come). */
  resetAccount() {
    /** homesdata `body.homes` */
    this.homes = [];
    this.topologyAt = 0;
    /** homeId -> homestatus `{ home, errors }` */
    this.statuses = new Map();
    this.seen = new Map();
    this.model = buildModel(this.gladys, []);
    this.reachable = new Map();
    this.published = undefined;
    /** featureId -> last value read, sent when the user creates the device */
    this.values = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (previous.clientId !== this.config.clientId) {
      this.resetAccount();
    }
    this.refreshCreated();
    if (this.tokens.load(raw, this.config)) {
      this.logger.info(
        'The client ID changed: the tokens of the previous Netatmo app are forgotten',
      );
      await this.tokens.forget();
    }
    if (!this.config.hasApp) {
      await this.setStatus(false, T.notConfigured);
      return;
    }
    if (!this.tokens.connected) {
      await this.setStatus(false, T.notConnected);
      return;
    }
    this.schedulePoll(0);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    for (const timer of this.confirmTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.confirmTimers.clear();
    this.rerun = false;
    this.limiter.clear(new Error('stopped'));
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  statusMessage() {
    const base =
      this.model.homes.length === 0
        ? T.noModule
        : T.connected(this.model.homes.length, this.model.devices.length);
    let message = this.tokens.hasAllScopes ? base : join(base, T.readOnly);
    // Bubendorff shutters seen, the token known to lack their write right
    // (linked before it was asked): the Legrand control is untouched.
    if (this.model.bubendorff > 0 && this.tokens.lacks(BRANDS.BUBENDORFF.write)) {
      message = join(message, T.addBubendorff);
    }
    return message;
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  // --- OAuth2 ("Connect" button) --------------------------------------------

  async authorizeUrl(key, redirectUri) {
    if (key !== OAUTH_FIELD) {
      throw new Error(`unknown account field "${key}"`);
    }
    if (!this.config.hasApp) {
      throw new Error(
        'type the client ID and the client secret of your Netatmo app and save the configuration first',
      );
    }
    if (typeof redirectUri !== 'string' || redirectUri === '') {
      throw new Error('Gladys gave no redirect URI');
    }
    const now = this.now();
    for (const [state, entry] of this.oauthStates) {
      if (entry.expiresAt <= now) {
        this.oauthStates.delete(state);
      }
    }
    const state = this.randomId();
    const scopes = this.legrandOnlyNext ? LEGRAND_SCOPES : SCOPES;
    this.legrandOnlyNext = false;
    this.oauthStates.set(state, { expiresAt: now + TIMINGS.oauthStateTtl, redirectUri, scopes });
    return authorizeUrl({ clientId: this.config.clientId, redirectUri, state, scopes });
  }

  async oauthCallback(key, { code, state, redirectUri } = {}) {
    if (key !== OAUTH_FIELD) {
      throw new Error(`unknown account field "${key}"`);
    }
    const pending = this.oauthStates.get(state);
    this.oauthStates.delete(state);
    if (!pending || pending.expiresAt <= this.now()) {
      throw new Error('this authorization is unknown or expired: click Connect again');
    }
    const askedBubendorff = pending.scopes.length > LEGRAND_SCOPES.length;
    if (typeof code !== 'string' || code === '') {
      // Refused on the Netatmo page: maybe by the user, maybe `invalid_scope`
      // (an app without the Bubendorff rights). The next click asks for the
      // Legrand rights only, once: no loop, every attempt is a click.
      if (askedBubendorff) {
        this.legrandOnlyNext = true;
        throw new Error(
          'Netatmo sent no authorization code (refused, or your Netatmo app does not offer the Bubendorff rights): click Connect again, the next attempt asks for the Legrand rights only',
        );
      }
      throw new Error('Netatmo sent no authorization code');
    }
    try {
      await this.tokens.exchange(code, redirectUri || pending.redirectUri, pending.scopes);
    } catch (err) {
      if (err?.kind === ERROR_KINDS.SCOPE && askedBubendorff) {
        this.legrandOnlyNext = true;
      }
      this.logger.warn(`Linking the Netatmo account failed: ${err.message}`);
      await this.setStatus(false, T.authFailed(reasonOf(err)));
      throw new Error(`Netatmo refused the authorization: ${reasonOf(err)}`, { cause: err });
    }
    this.logger.info('Netatmo account linked');
    this.resetAccount();
    this.failures = 0;
    this.linkDown = false;
    await this.setStatus(true, T.connecting);
    this.stop();
    this.schedulePoll(0);
  }

  // --- Polling ---------------------------------------------------------------

  schedulePoll(delay) {
    this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = this.timers.setTimeout(() => {
      this.pollTimer = undefined;
      this.runCycle();
    }, delay);
  }

  /** One poll at a time; a poll asked during another one runs right after it. */
  runCycle() {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.timers.clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.running = this.cycle(this.generation).finally(() => {
      this.running = undefined;
      if (this.rerun) {
        this.rerun = false;
        this.runCycle();
      }
    });
    return this.running;
  }

  async cycle(generation) {
    if (generation !== this.generation) {
      return;
    }
    let next = this.config.pollInterval * 1000;
    try {
      await this.tokens.flush();
      await this.refresh(generation, {
        topology: this.now() - this.topologyAt >= TIMINGS.topologyRefresh,
      });
      if (generation !== this.generation) {
        return;
      }
      this.failures = 0;
      await this.setStatus(true, this.statusMessage());
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      next = await this.onError(err);
    }
    if (next !== null && generation === this.generation) {
      this.schedulePoll(next);
    }
  }

  /** Reads the topology when needed, then the states of the homes, and applies them. */
  async refresh(generation, { topology = false, homeIds, priority = PRIORITY.BACKGROUND } = {}) {
    if (topology || this.topologyAt === 0) {
      const homes = await this.client.homesData();
      if (generation !== this.generation) {
        return;
      }
      this.homes = homes;
      this.topologyAt = this.now();
      this.model = buildModel(this.gladys, this.homes, this.statuses, this.seen);
    }
    for (const homeId of homeIds ?? this.model.homes.map((h) => h.id)) {
      const status = await this.client.homeStatus(homeId, priority);
      if (generation !== this.generation) {
        return;
      }
      this.statuses.set(homeId, status);
      mergeSeen(this.seen, status);
    }
    await this.apply();
  }

  /** Rebuilds the devices, publishes them when they changed, then the states and badges. */
  async apply() {
    this.linkDown = false;
    this.model = buildModel(this.gladys, this.homes, this.statuses, this.seen);
    for (const { id, type } of this.model.skipped) {
      this.warnOnce(`skip:${id}`, `Module ${id} (${type}): nothing Gladys can show yet`);
    }
    await this.publishDevices();
    const { values, reachable } = readStates(this.model, this.statuses);
    for (const [featureId, value] of values) {
      this.record(featureId, value);
    }
    this.reachable = reachable;
    await this.publisher.flush();
    await this.publishAllTransports();
  }

  async publishDevices(force = false) {
    const json = JSON.stringify(this.model.devices);
    if (!force && json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.model.devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.values.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  /** The next poll delay after a failure, or null to stop polling until the user acts. */
  async onError(err) {
    const interval = this.config.pollInterval * 1000;
    switch (err?.kind) {
      case ERROR_KINDS.GRANT:
        this.logger.warn(`Netatmo refused the authorization: ${err.message}`);
        this.linkDown = true;
        await this.setStatus(false, T.reconnect);
        await this.publishAllTransports();
        return null;
      case ERROR_KINDS.SCOPE:
        this.logger.warn(`Missing Home + Control rights: ${err.message}`);
        await this.setStatus(false, T.missingScope);
        return null;
      case ERROR_KINDS.APP:
        this.logger.warn(`Netatmo app deactivated: ${err.message}`);
        this.linkDown = true;
        await this.setStatus(false, T.appDeactivated);
        await this.publishAllTransports();
        return null;
      case ERROR_KINDS.THROTTLED: {
        const wait = Math.max(interval, err.retryAfter ?? TIMINGS.throttlePause);
        this.logger.warn(`Netatmo usage limit reached: ${err.message}`);
        await this.setStatus(false, T.throttled(Math.ceil(wait / 60_000)));
        return wait;
      }
      default: {
        this.failures += 1;
        this.logger.warn(`Reading the Netatmo homes failed: ${reasonOf(err)}`);
        if (this.failures >= 2) {
          this.linkDown = true;
          await this.publishAllTransports();
        }
        await this.setStatus(false, T.unreachable(reasonOf(err)));
        return Math.min(
          interval * 2 ** (this.failures - 1),
          Math.max(interval, TIMINGS.errorBackoffMax),
        );
      }
    }
  }

  // --- Transport badges --------------------------------------------------------

  transportOf(deviceId) {
    if (this.linkDown) {
      return DEVICE_TRANSPORTS.UNREACHABLE;
    }
    return this.reachable.get(deviceId) === false
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : DEVICE_TRANSPORTS.CLOUD;
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      if (!this.linkDown && !this.model.deviceModules.has(deviceId)) {
        continue;
      }
      const transport = this.transportOf(deviceId);
      if (this.transports.get(deviceId) !== transport) {
        this.transports.set(deviceId, transport);
        entries.push({ external_id: deviceId, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user ---------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.values.get(f.external_id);
      if (value !== undefined) {
        this.publisher.push(f.external_id, value);
      }
    }
    await this.publisher.flush();
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** Discovery tab: re-reads the account (topology included) and publishes the devices. */
  async scan() {
    if (this.tokens.connected && !this.tokens.refused) {
      if (this.now() - this.topologyAt > TIMINGS.scanFreshness) {
        this.topologyAt = 0;
      }
      await this.runCycle();
    }
    await this.publishDevices(true);
  }

  // --- Commands --------------------------------------------------------------

  /** Where a feature's command goes: the model, else the params of the device (before the first read). */
  routeOf(device, feature) {
    const route = this.model.routes.get(feature?.external_id);
    if (route) {
      return route;
    }
    const params = Object.fromEntries((device?.params ?? []).map((p) => [p.name, p.value]));
    const prefix = `${device?.external_id}:`;
    const key = String(feature?.external_id ?? '').startsWith(prefix)
      ? feature.external_id.slice(prefix.length)
      : undefined;
    if (params[PARAMS.HOME] && params[PARAMS.MODULE] && Object.values(FEATURES).includes(key)) {
      return {
        featureId: feature.external_id,
        deviceId: device.external_id,
        homeId: params[PARAMS.HOME],
        moduleId: params[PARAMS.MODULE],
        statusId: params[PARAMS.MODULE],
        bridge: params[PARAMS.BRIDGE] || undefined,
        key,
        type: params[PARAMS.TYPE],
        readOnly: feature.read_only === true,
      };
    }
    throw new Error(
      `${feature?.name ?? feature?.external_id} is not a Legrand Home + Control feature`,
    );
  }

  statusOf(route) {
    return (this.statuses.get(route.homeId)?.home?.modules ?? []).find(
      (m) => m?.id === route.statusId,
    );
  }

  async setValue(device, feature, value) {
    const route = this.routeOf(device, feature);
    if (route.readOnly) {
      throw new Error(`${feature?.name ?? route.key} is read-only`);
    }
    if (isShutterCommand(route)) {
      return this.shutterCommand(route, value);
    }
    const fields = commandFields(route, value, this.statusOf(route));
    if (!this.tokens.connected) {
      throw new Error('no Netatmo account is linked: click Connect in the configuration');
    }
    const { sent } = this.enqueue(route.homeId, moduleEntry(route, fields));
    const outcome = await this.within(
      sent.then(() => 'sent'),
      TIMINGS.commandAck,
    );
    if (outcome === 'sent') {
      this.accepted(route, value);
      return;
    }
    // The request waits for the Netatmo budget: ack now, apply when it goes.
    this.logger.info(`Command for ${route.moduleId} queued (Netatmo request budget)`);
    sent
      .then(() => this.accepted(route, value))
      .catch((err) => this.logger.warn(`Command for ${route.moduleId} failed: ${err.message}`));
  }

  /**
   * A shutter command (Legrand or Bubendorff): one at a time per device (a
   * stop never waits), decided on the last state read from Netatmo, never sent
   * after its ack: a command still waiting for the request budget when the ack
   * is due is withdrawn and refused; one that left without an answer yet is
   * "sent, without confirmation" and the home is read again.
   */
  async shutterCommand(route, value) {
    const started = this.now();
    const remaining = () => TIMINGS.commandAck - (this.now() - started);
    let fields = commandFields(route, value, this.statusOf(route));
    if (!this.tokens.connected) {
      throw new Error('no Netatmo account is linked: click Connect in the configuration');
    }
    const brand = brandOf(route.type);
    if (brand === BRANDS.BUBENDORFF && this.tokens.lacks(brand.write)) {
      throw new Error(
        'the authorization lacks write_bubendorff: click Connect again in the configuration to control the Bubendorff shutters',
      );
    }
    if (!isStop(fields)) {
      const previous = this.shutterQueue.get(route.deviceId);
      if (previous) {
        if ((await this.within(previous, remaining())) === LATE) {
          throw new Error(
            'not sent: the previous command of this shutter is still waiting for Netatmo, try again',
          );
        }
        // Decided again on what Netatmo answered meanwhile.
        fields = commandFields(route, value, this.statusOf(route));
      }
    }
    const job = this.enqueue(route.homeId, moduleEntry(route, fields), { exclusive: true });
    const settled = job.sent.then(
      () => undefined,
      () => undefined,
    );
    this.shutterQueue.set(route.deviceId, settled);
    settled.then(() => {
      if (this.shutterQueue.get(route.deviceId) === settled) {
        this.shutterQueue.delete(route.deviceId);
      }
    });
    const outcome = await this.within(
      job.sent.then(() => 'sent'),
      remaining(),
    );
    if (outcome === 'sent') {
      this.accepted(route, value);
      return;
    }
    if (job.withdraw()) {
      throw new Error(
        'not sent in time (Netatmo request budget, or a previous command), try again in a moment',
      );
    }
    job.sent
      .then(() => this.accepted(route, value))
      .catch((err) => this.logger.warn(`Command for ${route.moduleId}: ${err.message}`));
    throw new Error(
      'sent, without confirmation (Netatmo is slow to answer): the state is read again in a few seconds',
    );
  }

  /** Resolves the promise's value, or LATE after `ms` (its rejection still propagates). */
  within(promise, ms) {
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(LATE), Math.max(0, ms));
    });
    return Promise.race([promise, late]).finally(() => this.timers.clearTimeout(timer));
  }

  /**
   * Netatmo accepted a command: shows the expected states and reads the home
   * again soon. Never awaited by the ack: a slow Gladys does not delay it.
   */
  accepted(route, value) {
    for (const [key, v] of expectedStates(route, value)) {
      const featureId = `${route.deviceId}:${key}`;
      if (this.model.routes.has(featureId) || this.created.has(featureId)) {
        this.record(featureId, v);
      }
    }
    this.scheduleConfirm(route.homeId);
    this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Publishing the states failed: ${err.message}`));
  }

  /**
   * Commands of a same home within a short delay share one setstate request.
   * `exclusive` (shutters): the entry replaces a pending one of the same module,
   * whose command is refused as replaced. Returns `{ sent, withdraw }`:
   * `withdraw()` takes the command back while the request has not left.
   */
  enqueue(homeId, entry, { exclusive = false } = {}) {
    let batch = this.batches.get(homeId);
    if (!batch) {
      batch = { modules: new Map(), waiters: [], left: false };
      this.batches.set(homeId, batch);
      this.timers.setTimeout(() => this.sendBatch(homeId, batch), TIMINGS.commandBatch);
    }
    if (exclusive && batch.modules.has(entry.id)) {
      const replaced = new Error('not sent: replaced by a newer command of this shutter');
      for (const w of batch.waiters.filter((x) => x.moduleId === entry.id)) {
        w.reject(replaced);
      }
      batch.waiters = batch.waiters.filter((x) => x.moduleId !== entry.id);
    }
    batch.modules.set(entry.id, exclusive ? entry : { ...batch.modules.get(entry.id), ...entry });
    let waiter;
    const sent = new Promise((resolve, reject) => {
      waiter = { moduleId: entry.id, resolve, reject };
      batch.waiters.push(waiter);
    });
    const withdraw = () => {
      if (batch.left) {
        return false;
      }
      batch.waiters = batch.waiters.filter((w) => w !== waiter);
      if (!batch.waiters.some((w) => w.moduleId === entry.id)) {
        batch.modules.delete(entry.id);
      }
      waiter.reject(new Error('withdrawn before it was sent'));
      return true;
    };
    return { sent, withdraw };
  }

  async sendBatch(homeId, batch) {
    if (this.batches.get(homeId) === batch) {
      this.batches.delete(homeId);
    }
    let errors;
    try {
      errors = await this.client.setState(homeId, () => [...batch.modules.values()], {
        onSend: () => {
          batch.left = true;
        },
      });
    } catch (err) {
      const error = new Error(commandFailure(err));
      for (const waiter of batch.waiters) {
        waiter.reject(error);
      }
      if (err?.unconfirmed) {
        this.scheduleConfirm(homeId);
      }
      if (err?.kind === ERROR_KINDS.GRANT) {
        await this.setStatus(false, T.reconnect);
      }
      return;
    }
    if (errors === null) {
      return; // every command was withdrawn before the request left
    }
    const codes = new Map(errors.map((e) => [String(e?.id), Number(e?.code)]));
    for (const waiter of batch.waiters) {
      const code = codes.get(waiter.moduleId);
      if (code === undefined || code === NOTHING_TO_MODIFY) {
        waiter.resolve();
      } else {
        waiter.reject(new Error(MODULE_ERRORS[code] ?? `Netatmo error ${code}`));
      }
    }
  }

  /** Reads the home again a few seconds after a command (coalesced). */
  scheduleConfirm(homeId) {
    this.timers.clearTimeout(this.confirmTimers.get(homeId));
    const generation = this.generation;
    this.confirmTimers.set(
      homeId,
      this.timers.setTimeout(() => {
        this.confirmTimers.delete(homeId);
        this.refresh(generation, { homeIds: [homeId] }).catch((err) =>
          this.logger.debug(`Reading the states after a command failed: ${reasonOf(err)}`),
        );
      }, TIMINGS.confirmDelay),
    );
  }

  // --- Configuration screen button -------------------------------------------

  async testConnection() {
    if (!this.config.hasApp) {
      return T.notConfigured;
    }
    if (!this.tokens.connected) {
      return T.notConnected;
    }
    try {
      await this.refresh(this.generation, { topology: true });
      return T.test.ok(
        this.model.homes.length,
        this.model.devices.length,
        this.model.skipped.length,
      );
    } catch (err) {
      return T.test.failed(reasonOf(err));
    }
  }
}
