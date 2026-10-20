import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('web/app');
const en = (await import(path.join(root, 'locales/en.js'))).default;
const uk = (await import(path.join(root, 'locales/uk.js'))).default;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(path.join(dir, e.name))) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

const src = walk(root).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// Every string literal that looks like a translation key must exist in English.
const NAMESPACES = ['common', 'nav', 'auth', 'home', 'search', 'sort', 'track', 'status', 'license', 'count', 'artist', 'library', 'playlist', 'player', 'upload', 'edit', 'report', 'settings', 'admin', 'role', 'notfound', 'about', 'err'];
const used = new Set();
for (const m of src.matchAll(/'((?:[a-z]+)(?:\.[A-Za-z_0-9]+)+)'/g)) {
  if (NAMESPACES.includes(m[1].split('.')[0])) used.add(m[1]);
}

test('every key used in the client exists in English (plural keys by base name)', () => {
  const missing = [...used].filter((k) => !(k in en) && !(`${k}.other` in en));
  assert.deepEqual(missing, []);
});

test('Ukrainian has exactly the same keys as English, plus the extra plural forms', () => {
  const strip = (k) => k.replace(/\.(one|few|many|other)$/, '');
  const enBase = new Set(Object.keys(en).map(strip));
  const ukBase = new Set(Object.keys(uk).map(strip));
  assert.deepEqual([...enBase].filter((k) => !ukBase.has(k)), [], 'missing in uk');
  assert.deepEqual([...ukBase].filter((k) => !enBase.has(k)), [], 'extra in uk');
});

test('placeholders match between languages', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const [k, v] of Object.entries(en)) {
    if (uk[k] !== undefined) assert.equal(ph(uk[k]), ph(v), k);
  }
});

test('dynamic key families are complete', () => {
  const need = [
    ...['pending', 'removed', 'published'].map((x) => `status.${x}`),
    ...['commercial', 'non_commercial'].map((x) => `license.${x}`),
    ...['new', 'popular', 'liked', 'title'].map((x) => `sort.${x}`),
    ...['copyright', 'voice_imitation', 'not_ai', 'abuse', 'other'].map((x) => `report.reason.${x}`),
    ...['off', 'all', 'one'].map((x) => `player.repeat.${x}`),
    ...['system', 'dark', 'light'].map((x) => `settings.theme.${x}`),
    ...['liked', 'playlists', 'uploads'].map((x) => `library.${x}`),
    ...['reports', 'queue', 'removed', 'users'].map((x) => `admin.tab.${x}`),
    ...['users', 'tracks', 'pending', 'openReports', 'plays', 'storage'].map((x) => `admin.stat.${x}`),
    ...['dismissed', 'removed'].map((x) => `admin.resolution.${x}`),
    ...['user', 'moderator', 'admin'].map((x) => `role.${x}`),
    ...['like', 'playlist'].map((x) => `auth.reason.${x}`),
    ...['rules', 'rights', 'report', 'privacy', 'oss'].map((x) => `about.${x}.title`),
  ];
  for (const k of need) {
    assert.ok(k in en, `en ${k}`);
    assert.ok(k in uk, `uk ${k}`);
  }
});

test('every server error code has a translation', () => {
  const serverSrc = walk(path.resolve('server')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const codes = new Set();
  for (const m of serverSrc.matchAll(/(?:badRequest|conflict)\('([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of serverSrc.matchAll(/new ApiError\(\d+, '([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of serverSrc.matchAll(/`missing_\$\{key\}`/g)) { codes.add('missing_title'); codes.add('missing_prompt'); }
  const missing = [...codes].filter((c) => !(`err.${c}` in en) || !(`err.${c}` in uk));
  assert.deepEqual(missing, []);
});
