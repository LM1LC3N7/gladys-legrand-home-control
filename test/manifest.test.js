// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, OAUTH_FIELD, POLL_INTERVAL, TOKEN_KEYS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(
    manifest.docker_image,
    `ghcr.io/lm1lc3n7/gladys-legrand-home-control:${manifest.version}`,
  );
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || !['', null].includes(value)) {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  assert.equal(fields.client_id.required, true);
  assert.equal(fields.client_secret.type, 'secret');
  assert.equal(fields.poll_interval.min, POLL_INTERVAL.min);
  assert.equal(fields.poll_interval.max, POLL_INTERVAL.max);
  assert.ok(POLL_INTERVAL.min >= 60, 'Netatmo usage limits: one minute minimum');

  const account = fields[OAUTH_FIELD];
  assert.equal(account.type, 'oauth2');
  assert.equal(account.default, undefined);
  assert.ok(
    manifest.config_schema.indexOf(account) > manifest.config_schema.indexOf(fields.client_secret),
    'Connect comes after the app credentials',
  );
  for (const key of Object.values(TOKEN_KEYS)) {
    assert.equal(fields[key], undefined, `${key} is stored off-schema, never shown`);
    assert.match(key, /^[a-z0-9_]+$/, 'Gladys config keys');
  }

  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(intro.description[lang], /Bubendorff ni Netatmo|Bubendorff or Netatmo/);
    assert.match(
      intro.description[lang],
      /never tested with real Bubendorff|jamais testé avec de vrais volets Bubendorff/,
    );
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: multi-language placeholder`);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const handler of ['onOAuthAuthorizeUrl', 'onOAuthCallback', 'onSetValue', 'onScanRequest']) {
    assert.ok(handlers.includes(`${handler}(`), `${handler} is not registered`);
  }
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.webhooks, undefined, 'webhooks come in a later milestone');
});

test('no BOM, no mojibake, never "encrypted" in the texts', () => {
  const files = [
    'gladys-assistant-integration.json',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'THIRD_PARTY_NOTICES.md',
    'docs/en.md',
    'docs/fr.md',
    'src/i18n.js',
  ];
  for (const file of files) {
    const text = read(file);
    assert.notEqual(text.charCodeAt(0), 0xfeff, `${file} starts with a BOM`);
    assert.doesNotMatch(
      text,
      /\u00c3[\u0080-\u00bf\u0192]|\u00c2[\u0080-\u00bf]|\u00e2\u20ac/,
      `${file} has mojibake`,
    );
    assert.doesNotMatch(text, /chiffr|encrypt/i, `${file}: a secret is not encrypted by Gladys`);
  }
});
