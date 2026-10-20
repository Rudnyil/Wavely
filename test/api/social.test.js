import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeApp, call, register, upload, audio, image } from '../helpers.js';

describe('playlists', () => {
  let ctx; let alice; let bob; let t1; let t2; let t3;
  before(async () => {
    ctx = await makeApp();
    alice = await register(ctx.app, 'alice');
    bob = await register(ctx.app, 'bob');
    [t1, t2, t3] = [
      (await upload(ctx.app, alice.cookie, { title: 'One' })).json.id,
      (await upload(ctx.app, alice.cookie, { title: 'Two' })).json.id,
      (await upload(ctx.app, alice.cookie, { title: 'Three' })).json.id,
    ];
  });
  after(async () => { await ctx.close(); });

  test('create, list, validation, auth', async () => {
    assert.equal((await call(ctx.app, 'POST', '/api/playlists', { body: { name: 'x' } })).status, 401);
    assert.equal((await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: '   ' } })).status, 400);
    const r = await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: 'Focus', description: 'work', isPublic: false } });
    assert.equal(r.status, 201);
    assert.equal(r.json.name, 'Focus');
    assert.equal(r.json.isPublic, false);
    const list = await call(ctx.app, 'GET', '/api/playlists', { cookie: bob.cookie });
    assert.equal(list.json.items.length, 1);
  });

  test('add, order, remove tracks; no duplicates', async () => {
    const pl = (await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: 'Mix' } })).json;
    for (const id of [t1, t2, t3, t2]) {
      const r = await call(ctx.app, 'POST', `/api/playlists/${pl.id}/tracks`, { cookie: bob.cookie, body: { trackId: id } });
      assert.equal(r.status, 201);
    }
    let cur = (await call(ctx.app, 'GET', `/api/playlists/${pl.id}`, { cookie: bob.cookie })).json;
    assert.deepEqual(cur.items.map((t) => t.id), [t1, t2, t3]);
    const re = await call(ctx.app, 'PUT', `/api/playlists/${pl.id}/order`, { cookie: bob.cookie, body: { trackIds: [t3, t1, t2] } });
    assert.deepEqual(re.json.items.map((t) => t.id), [t3, t1, t2]);
    const bad = await call(ctx.app, 'PUT', `/api/playlists/${pl.id}/order`, { cookie: bob.cookie, body: { trackIds: [t3, t1] } });
    assert.equal(bad.status, 400);
    const dup = await call(ctx.app, 'PUT', `/api/playlists/${pl.id}/order`, { cookie: bob.cookie, body: { trackIds: [t3, t3, t1] } });
    assert.equal(dup.status, 400);
    cur = (await call(ctx.app, 'DELETE', `/api/playlists/${pl.id}/tracks/${t1}`, { cookie: bob.cookie })).json;
    assert.deepEqual(cur.items.map((t) => t.id), [t3, t2]);
    assert.equal(cur.tracks, 2);
    assert.equal((await call(ctx.app, 'POST', `/api/playlists/${pl.id}/tracks`, { cookie: bob.cookie, body: { trackId: 'nope' } })).status, 404);
  });

  test('privacy: private playlists are invisible to others; public ones readable, not editable', async () => {
    const priv = (await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: 'Secret' } })).json;
    const pub = (await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: 'Shared', isPublic: true } })).json;
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${priv.id}`)).status, 404);
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${priv.id}`, { cookie: alice.cookie })).status, 200, 'moderators/admins can inspect');
    const aliceUser = await register(ctx.app, 'carol');
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${priv.id}`, { cookie: aliceUser.cookie })).status, 404);
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${pub.id}`)).status, 200);
    assert.equal((await call(ctx.app, 'PATCH', `/api/playlists/${pub.id}`, { cookie: aliceUser.cookie, body: { name: 'mine now' } })).status, 403);
    assert.equal((await call(ctx.app, 'DELETE', `/api/playlists/${pub.id}`, { cookie: aliceUser.cookie })).status, 403);
    assert.equal((await call(ctx.app, 'POST', `/api/playlists/${priv.id}/tracks`, { cookie: aliceUser.cookie, body: { trackId: t1 } })).status, 404);
    const pubList = await call(ctx.app, 'GET', '/api/users/bob/playlists');
    assert.ok(pubList.json.items.every((p) => p.isPublic));
    assert.ok(!pubList.json.items.some((p) => p.id === priv.id));
  });

  test('rename/toggle visibility and delete', async () => {
    const pl = (await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: 'Temp' } })).json;
    const up = await call(ctx.app, 'PATCH', `/api/playlists/${pl.id}`, { cookie: bob.cookie, body: { name: 'Renamed', isPublic: true } });
    assert.equal(up.json.name, 'Renamed');
    assert.equal(up.json.isPublic, true);
    assert.equal((await call(ctx.app, 'DELETE', `/api/playlists/${pl.id}`, { cookie: bob.cookie })).status, 200);
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${pl.id}`, { cookie: bob.cookie })).status, 404);
  });

  test('deleting a track removes it from playlists', async () => {
    const extra = (await upload(ctx.app, alice.cookie, { title: 'Gone soon' })).json.id;
    const pl = (await call(ctx.app, 'POST', '/api/playlists', { cookie: bob.cookie, body: { name: 'Cascade' } })).json;
    await call(ctx.app, 'POST', `/api/playlists/${pl.id}/tracks`, { cookie: bob.cookie, body: { trackId: extra } });
    await call(ctx.app, 'DELETE', `/api/tracks/${extra}`, { cookie: alice.cookie });
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${pl.id}`, { cookie: bob.cookie })).json.items.length, 0);
  });
});

describe('reports and moderation', () => {
  let ctx; let admin; let mod; let user; let trackId;
  before(async () => {
    ctx = await makeApp();
    admin = await register(ctx.app, 'root');
    mod = await register(ctx.app, 'mod');
    user = await register(ctx.app, 'author');
    await call(ctx.app, 'PATCH', `/api/admin/users/${mod.user.id}`, { cookie: admin.cookie, body: { role: 'moderator' } });
    trackId = (await upload(ctx.app, user.cookie, { title: 'Questionable' })).json.id;
  });
  after(async () => { await ctx.close(); });

  test('anyone can report; reason validated', async () => {
    const bad = await call(ctx.app, 'POST', `/api/tracks/${trackId}/report`, { body: { reason: 'nonsense' } });
    assert.equal(bad.status, 400);
    const r = await call(ctx.app, 'POST', `/api/tracks/${trackId}/report`, { body: { reason: 'copyright', details: 'Sounds like my song', contact: 'me@example.org' } });
    assert.equal(r.status, 201);
    const r2 = await call(ctx.app, 'POST', `/api/tracks/${trackId}/report`, { cookie: mod.cookie, body: { reason: 'not_ai' } });
    assert.equal(r2.status, 201);
    assert.equal((await call(ctx.app, 'POST', '/api/tracks/missing/report', { body: { reason: 'abuse' } })).status, 404);
  });

  test('moderator panel is restricted', async () => {
    for (const url of ['/api/admin/reports', '/api/admin/stats', '/api/admin/tracks']) {
      assert.equal((await call(ctx.app, 'GET', url)).status, 401);
      assert.equal((await call(ctx.app, 'GET', url, { cookie: user.cookie })).status, 403);
      assert.equal((await call(ctx.app, 'GET', url, { cookie: mod.cookie })).status, 200);
    }
    assert.equal((await call(ctx.app, 'GET', '/api/admin/users', { cookie: mod.cookie })).status, 403, 'user management is admin-only');
  });

  test('dismissing resolves all open reports for the track, track stays', async () => {
    const reports = (await call(ctx.app, 'GET', '/api/admin/reports', { cookie: mod.cookie })).json.items;
    assert.equal(reports.length, 2);
    assert.equal(reports[0].trackTitle, 'Questionable');
    const bad = await call(ctx.app, 'POST', `/api/admin/reports/${reports[0].id}/resolve`, { cookie: mod.cookie, body: { resolution: 'bogus' } });
    assert.equal(bad.status, 400);
    const ok = await call(ctx.app, 'POST', `/api/admin/reports/${reports[0].id}/resolve`, { cookie: mod.cookie, body: { resolution: 'dismissed' } });
    assert.equal(ok.status, 200);
    assert.equal((await call(ctx.app, 'GET', '/api/admin/reports', { cookie: mod.cookie })).json.items.length, 0);
    assert.equal((await call(ctx.app, 'GET', '/api/admin/reports?status=resolved', { cookie: mod.cookie })).json.items.length, 2);
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`)).status, 200);
  });

  test('removing via a report hides the track everywhere but keeps the files for review', async () => {
    await call(ctx.app, 'POST', `/api/tracks/${trackId}/report`, { body: { reason: 'abuse' } });
    const rep = (await call(ctx.app, 'GET', '/api/admin/reports', { cookie: mod.cookie })).json.items[0];
    await call(ctx.app, 'POST', `/api/admin/reports/${rep.id}/resolve`, { cookie: mod.cookie, body: { resolution: 'removed' } });
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`)).status, 404);
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`, { cookie: user.cookie })).status, 404, 'even the owner cannot see removed tracks');
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}/stream`)).status, 404);
    assert.equal((await call(ctx.app, 'GET', '/api/tracks')).json.total, 0);
    assert.equal((await call(ctx.app, 'GET', '/api/tracks?q=questionable')).json.total, 0);
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`, { cookie: mod.cookie })).status, 200);
    assert.equal((await call(ctx.app, 'GET', '/api/admin/tracks?status=removed', { cookie: mod.cookie })).json.items.length, 1);
    assert.ok(fs.existsSync(ctx.app.storage.audioPath(trackId)));
    const restore = await call(ctx.app, 'POST', `/api/admin/tracks/${trackId}/status`, { cookie: mod.cookie, body: { status: 'published' } });
    assert.equal(restore.status, 200);
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`)).status, 200);
  });

  test('stats', async () => {
    const s = (await call(ctx.app, 'GET', '/api/admin/stats', { cookie: admin.cookie })).json;
    assert.equal(s.users, 3);
    assert.equal(s.tracks, 1);
    assert.ok(s.storageBytes > 0);
  });

  test('user management: roles, no self-lockout, last-admin safety', async () => {
    const list = (await call(ctx.app, 'GET', '/api/admin/users?q=aut', { cookie: admin.cookie })).json.items;
    assert.equal(list.length, 1);
    assert.equal(list[0].username, 'author');
    const self = await call(ctx.app, 'PATCH', `/api/admin/users/${admin.user.id}`, { cookie: admin.cookie, body: { role: 'user' } });
    assert.equal(self.status, 409);
    const selfDisable = await call(ctx.app, 'PATCH', `/api/admin/users/${admin.user.id}`, { cookie: admin.cookie, body: { disabled: true } });
    assert.equal(selfDisable.status, 409);
    assert.equal((await call(ctx.app, 'PATCH', `/api/admin/users/${user.user.id}`, { cookie: admin.cookie, body: { role: 'emperor' } })).status, 400);
    assert.equal((await call(ctx.app, 'PATCH', '/api/admin/users/99999', { cookie: admin.cookie, body: { role: 'user' } })).status, 404);
    assert.equal((await call(ctx.app, 'PATCH', `/api/admin/users/${user.user.id}`, { cookie: mod.cookie, body: { role: 'admin' } })).status, 403, 'moderators cannot escalate');
    assert.equal((await call(ctx.app, 'PATCH', `/api/admin/users/${user.user.id}`, { cookie: user.cookie, body: { role: 'admin' } })).status, 403, 'users cannot escalate');
  });
});

describe('security', () => {
  let ctx; let alice;
  before(async () => { ctx = await makeApp(); alice = await register(ctx.app, 'alice'); });
  after(async () => { await ctx.close(); });

  test('state-changing requests without the custom header are rejected (CSRF)', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/playlists', headers: { cookie: alice.cookie, 'content-type': 'application/json' }, payload: '{"name":"x"}' });
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().error.code, 'csrf');
  });

  test('cross-origin requests are rejected even with the header', async () => {
    const r = await call(ctx.app, 'POST', '/api/playlists', { cookie: alice.cookie, body: { name: 'x' }, headers: { origin: 'https://evil.example', host: 'wavely.local' } });
    assert.equal(r.status, 403);
    const same = await call(ctx.app, 'POST', '/api/playlists', { cookie: alice.cookie, body: { name: 'x' }, headers: { origin: 'http://wavely.local', host: 'wavely.local' } });
    assert.equal(same.status, 201);
    const nul = await call(ctx.app, 'POST', '/api/playlists', { cookie: alice.cookie, body: { name: 'x' }, headers: { origin: 'null' } });
    assert.equal(nul.status, 403);
  });

  test('no CORS headers are ever sent', async () => {
    const r = await call(ctx.app, 'GET', '/api/tracks', { headers: { origin: 'https://evil.example' } });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  test('security headers on pages and API', async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/' });
    const csp = page.headers['content-security-policy'];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.ok(!/unsafe-inline'[^;]*;?\s*style-src /.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), 'no inline scripts allowed');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    const api = await call(ctx.app, 'GET', '/api/config');
    assert.equal(api.headers['cache-control'], 'no-store');
  });

  test('importmap hash in the CSP matches the page', async () => {
    const crypto = await import('node:crypto');
    const page = await ctx.app.inject({ method: 'GET', url: '/' });
    const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(page.body);
    assert.ok(m, 'page has an import map');
    const hash = crypto.createHash('sha256').update(m[1]).digest('base64');
    assert.ok(page.headers['content-security-policy'].includes(`'sha256-${hash}'`));
  });

  test('path traversal is not possible via static, vendor or track ids', async () => {
    for (const url of ['/../package.json', '/%2e%2e/package.json', '/vendor/preact/../../package.json', '/vendor/%2e%2e/%2e%2e/package.json', '/..%2fserver/config.js', '/api/tracks/..%2f..%2fdata/stream', '/server/config.js', '/data/wavely.db', '/.env']) {
      const r = await ctx.app.inject({ method: 'GET', url });
      assert.ok(![200, 206].includes(r.statusCode) || r.headers['content-type'].startsWith('text/html'), `${url} -> ${r.statusCode}`);
      assert.ok(!/better-sqlite3|"name": "wavely"|loadConfig/.test(r.body), url);
    }
  });

  test('unknown paths: SPA fallback for pages, 404 for assets and API', async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/library/some-playlist' });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/missing.js' })).statusCode, 404);
    assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/unknown' })).statusCode, 404);
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/library' })).statusCode, 404);
  });

  test('malformed JSON and wrong content types give 4xx, never 500', async () => {
    const bad = await call(ctx.app, 'POST', '/api/auth/login', { payload: '{not json', headers: { 'content-type': 'application/json' } });
    assert.equal(bad.status, 400);
    const text = await call(ctx.app, 'POST', '/api/auth/login', { payload: 'a=b', headers: { 'content-type': 'text/plain' } });
    assert.ok([400, 415].includes(text.status));
    const arr = await call(ctx.app, 'POST', '/api/auth/login', { body: [1, 2, 3] });
    assert.ok(arr.status >= 400 && arr.status < 500);
    const nums = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 5, password: { a: 1 } } });
    assert.ok(nums.status >= 400 && nums.status < 500);
    const reg = await call(ctx.app, 'POST', '/api/auth/register', { body: { username: ['x'], password: 'longenough1' } });
    assert.ok(reg.status >= 400 && reg.status < 500);
  });

  test('oversized JSON bodies are refused', async () => {
    const r = await call(ctx.app, 'POST', '/api/auth/login', { payload: JSON.stringify({ username: 'a', password: 'x'.repeat(2 * 1024 * 1024) }), headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 413);
  });

  test('repeated failed logins are throttled per username', async () => {
    await register(ctx.app, 'victim');
    let last;
    for (let i = 0; i < 9; i += 1) last = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'victim', password: 'wrong password' } });
    assert.equal(last.status, 429);
    const correct = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'victim', password: 'correct horse battery' } });
    assert.equal(correct.status, 429, 'even the right password is refused while blocked');
  });

  test('cover generation does not leak into track ids with odd characters', async () => {
    const r = await call(ctx.app, 'GET', '/api/tracks/%00/cover');
    assert.equal(r.status, 404);
  });

  test('uploaded cover dimensions are 640x640', async () => {
    const up = await upload(ctx.app, alice.cookie, {}, audio.mp3(), { cover: { filename: 'c.png', type: 'image/png', data: image.png() } });
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ctx.app.storage.coverPath(up.json.id)]).toString().trim();
    assert.equal(out, '640,640');
  });
});

describe('rate limiting (enabled)', () => {
  test('registration is limited per IP', async () => {
    const c = await makeApp({ RATE_LIMIT: 'true' });
    try {
      const codes = [];
      for (let i = 0; i < 12; i += 1) {
        const r = await call(c.app, 'POST', '/api/auth/register', { body: { username: `user${i}x`, password: 'correct horse battery' } });
        codes.push(r.status);
      }
      assert.ok(codes.includes(429), codes.join(','));
      assert.equal(codes[0], 201);
      const r = await call(c.app, 'POST', '/api/auth/register', { body: { username: 'zzz', password: 'correct horse battery' } });
      assert.equal(r.json.error.code, 'rate_limited');
    } finally { await c.close(); }
  });
});

test('health endpoint and config', async () => {
  const c = await makeApp();
  try {
    const h = await call(c.app, 'GET', '/healthz');
    assert.deepEqual({ status: h.json.status, ffmpeg: h.json.ffmpeg }, { status: 'ok', ffmpeg: true });
    const cfg = (await call(c.app, 'GET', '/api/config')).json;
    assert.equal(cfg.name, 'Wavely');
    assert.equal(cfg.registration, 'open');
  } finally { await c.close(); }
});
