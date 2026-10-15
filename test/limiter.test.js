import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIORITY, RequestLimiter } from '../src/limiter.js';
import { LIMITS } from '../src/constants.js';
import { settle } from './helpers/fakeNetatmo.js';

function setup(t, limits = LIMITS) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const limiter = new RequestLimiter({ now: () => Date.now(), limits });
  const granted = [];
  const ask = (label, priority = PRIORITY.BACKGROUND) =>
    limiter.acquire(priority).then(
      () => granted.push(label),
      (err) => granted.push(`${label}:${err.message}`),
    );
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle(5);
  };
  return { limiter, granted, ask, tick };
}

test('background requests are spaced, commands are not', async (t) => {
  const { granted, ask, tick } = setup(t);
  ask('poll-1');
  ask('poll-2');
  ask('cmd', PRIORITY.COMMAND);
  await tick(0);
  assert.deepEqual(granted, ['poll-1', 'cmd']);
  await tick(LIMITS.backgroundSpacing - 1);
  assert.deepEqual(granted, ['poll-1', 'cmd']);
  await tick(1);
  assert.deepEqual(granted, ['poll-1', 'cmd', 'poll-2']);
});

test('at most `burst` requests in any window', async (t) => {
  const { granted, ask, tick } = setup(t);
  for (let i = 1; i <= LIMITS.burst + 1; i += 1) {
    ask(`cmd-${i}`, PRIORITY.COMMAND);
  }
  await tick(0);
  assert.equal(granted.length, LIMITS.burst);
  await tick(LIMITS.burstWindow - 1);
  assert.equal(granted.length, LIMITS.burst);
  await tick(1);
  assert.equal(granted.at(-1), `cmd-${LIMITS.burst + 1}`);
});

test('commands go before the waiting background requests', async (t) => {
  const { granted, ask, tick } = setup(t);
  ask('poll-1');
  ask('poll-2');
  ask('poll-3');
  await tick(0);
  ask('cmd', PRIORITY.COMMAND);
  await tick(0);
  assert.deepEqual(granted, ['poll-1', 'cmd']);
  await tick(LIMITS.backgroundSpacing);
  await tick(LIMITS.backgroundSpacing);
  assert.deepEqual(granted, ['poll-1', 'cmd', 'poll-2', 'poll-3']);
});

test('the background leaves the end of the hourly budget to the commands', async (t) => {
  const limits = { ...LIMITS, burst: 1000, backgroundSpacing: 0, hourly: 10, commandReserve: 3 };
  const { granted, ask, tick, limiter } = setup(t, limits);
  for (let i = 0; i < 8; i += 1) {
    ask(`poll-${i}`);
  }
  await tick(0);
  assert.equal(granted.length, 7, 'background stops at hourly - reserve');
  ask('cmd-1', PRIORITY.COMMAND);
  ask('cmd-2', PRIORITY.COMMAND);
  ask('cmd-3', PRIORITY.COMMAND);
  ask('cmd-4', PRIORITY.COMMAND);
  await tick(0);
  assert.deepEqual(granted.slice(7), ['cmd-1', 'cmd-2', 'cmd-3']);
  assert.equal(limiter.hourCount, 10);
  await tick(3_600_000);
  assert.ok(granted.includes('cmd-4') && granted.includes('poll-7'), 'the hour has passed');
});

test('a pause holds everything, clear rejects the waiting requests', async (t) => {
  const { limiter, granted, ask, tick } = setup(t);
  limiter.pause(Date.now() + 60_000);
  assert.equal(limiter.paused, true);
  ask('cmd', PRIORITY.COMMAND);
  await tick(59_999);
  assert.deepEqual(granted, []);
  await tick(1);
  assert.deepEqual(granted, ['cmd']);
  limiter.pause(Date.now() + 60_000);
  ask('poll');
  await tick(0);
  limiter.clear(new Error('stopped'));
  await tick(0);
  assert.deepEqual(granted, ['cmd', 'poll:stopped']);
});
