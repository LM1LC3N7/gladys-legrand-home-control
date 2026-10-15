// -----------------------------------------------------------------------------
// The Netatmo request budget. Every API request waits for a slot here: at most
// `burst` requests in any `burstWindow`, `hourly` per hour; background requests
// (polls, topology) are spaced by `backgroundSpacing` and leave
// `commandReserve` of the hour to the commands; commands are served first.
// After a usage-limit answer, everything pauses until the given time.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';

const HOUR = 3_600_000;

export const PRIORITY = { COMMAND: 'command', BACKGROUND: 'background' };

export class RequestLimiter {
  constructor({ now = Date.now, timers = globalThis, limits = LIMITS } = {}) {
    this.now = now;
    this.timers = timers;
    this.limits = limits;
    /** Send times of the last hour, oldest first. */
    this.sent = [];
    this.lastBackground = -Infinity;
    this.pausedUntil = 0;
    /** Waiting requests: the commands first, each kind in arrival order. */
    this.queue = [];
    this.timer = undefined;
  }

  /** Resolves when a request of this priority may be sent. */
  acquire(priority = PRIORITY.BACKGROUND) {
    return new Promise((resolve, reject) => {
      const entry = { priority, resolve, reject };
      if (priority === PRIORITY.COMMAND) {
        const firstBackground = this.queue.findIndex((e) => e.priority !== PRIORITY.COMMAND);
        this.queue.splice(firstBackground === -1 ? this.queue.length : firstBackground, 0, entry);
      } else {
        this.queue.push(entry);
      }
      this.drain();
    });
  }

  /** Milliseconds before a request of this priority may go (0: now). */
  delay(priority, t = this.now()) {
    const { burst, burstWindow, backgroundSpacing, hourly, commandReserve } = this.limits;
    while (this.sent.length > 0 && this.sent[0] <= t - HOUR) {
      this.sent.shift();
    }
    let until = this.pausedUntil;
    const recent = this.sent.filter((s) => t - s < burstWindow);
    if (recent.length >= burst) {
      until = Math.max(until, recent[recent.length - burst] + burstWindow);
    }
    const cap = priority === PRIORITY.COMMAND ? hourly : hourly - commandReserve;
    if (this.sent.length >= cap) {
      until = Math.max(until, this.sent[this.sent.length - cap] + HOUR);
    }
    if (priority !== PRIORITY.COMMAND) {
      until = Math.max(until, this.lastBackground + backgroundSpacing);
    }
    return Math.max(0, until - t);
  }

  drain() {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    while (this.queue.length > 0) {
      const head = this.queue[0];
      const wait = this.delay(head.priority);
      if (wait > 0) {
        this.timer = this.timers.setTimeout(() => this.drain(), wait);
        return;
      }
      this.queue.shift();
      const t = this.now();
      this.sent.push(t);
      if (head.priority !== PRIORITY.COMMAND) {
        this.lastBackground = t;
      }
      head.resolve();
    }
  }

  /** Nothing is sent before `until` (a usage limit was reached). */
  pause(until) {
    this.pausedUntil = Math.max(this.pausedUntil, until);
    this.drain();
  }

  get paused() {
    return this.pausedUntil > this.now();
  }

  /** Requests sent in the last hour. */
  get hourCount() {
    this.delay(PRIORITY.COMMAND);
    return this.sent.length;
  }

  /** Rejects the waiting requests (the integration stops or reconnects). */
  clear(reason = new Error('stopped')) {
    this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    const waiting = this.queue;
    this.queue = [];
    for (const entry of waiting) {
      entry.reject(reason);
    }
  }
}
