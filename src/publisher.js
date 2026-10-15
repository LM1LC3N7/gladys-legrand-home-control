// -----------------------------------------------------------------------------
// The states sent to Gladys, within its 300 states per minute.
//
// A poll reads every module at once: the publisher keeps the LAST value of
// each feature, sends the changed ones (publishChangedStates) within a
// per-minute budget, and keeps the rest for the next flush (the next poll or
// command). An unchanged value is re-sent every 30 minutes (heartbeat).
// -----------------------------------------------------------------------------

import { LIMITS, TIMINGS } from './constants.js';

export class StatePublisher {
  constructor({ gladys, logger, now = Date.now, budget = LIMITS.statesPerMinute }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.budget = budget;
    /** featureId -> state */
    this.pending = new Map();
    /** send times of the last minute */
    this.window = [];
    this.flushing = undefined;
  }

  push(featureId, state) {
    this.pending.set(featureId, state);
  }

  /** Forgets the pending values of a device (deleted by the user). */
  forget(deviceId) {
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${deviceId}:`)) {
        this.pending.delete(key);
      }
    }
  }

  /** Sends the pending values; flushes run one after the other, none is skipped. */
  flush() {
    this.flushing = (this.flushing ?? Promise.resolve()).then(() =>
      this.doFlush().catch((err) => {
        this.logger?.warn(`Sending the states failed: ${err.message}`);
        return 0;
      }),
    );
    return this.flushing;
  }

  async doFlush() {
    const now = this.now();
    this.window = this.window.filter((t) => now - t < 60_000);
    const room = this.budget - this.window.length;
    if (room <= 0 || this.pending.size === 0) {
      return 0;
    }
    const batch = [...this.pending].slice(0, room);
    for (const [featureId] of batch) {
      this.pending.delete(featureId);
    }
    try {
      const result = await this.gladys.publishChangedStates(
        batch.map(([featureId, state]) => ({ device_feature_external_id: featureId, state })),
        { heartbeat: TIMINGS.stateHeartbeat },
      );
      const count = result?.count ?? batch.length;
      for (let i = 0; i < count; i += 1) {
        this.window.push(now);
      }
      return count;
    } catch (err) {
      // Keep the values for the next flush, unless a newer one arrived meanwhile.
      for (const [featureId, state] of batch) {
        if (!this.pending.has(featureId)) {
          this.pending.set(featureId, state);
        }
      }
      throw err;
    }
  }
}
