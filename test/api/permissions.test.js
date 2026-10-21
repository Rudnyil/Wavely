import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, register, upload } from '../helpers.js';

/**
 * Permission matrix. Every /api route must be classified here; a new route without a class fails the test,
 * so access rules cannot be forgotten.
 *   public  - works without signing in
 *   user    - 401 when anonymous
 *   mod     - 401 anonymous, 403 for a regular user
 *   admin   - 401 anonymous, 403 for a regular user and for a moderator
 */
const CLASSES = {
  public: [
    'GET /api/artists', 'GET /api/artists/:username', 'GET /api/config', 'GET /api/genres', 'GET /api/health', 'GET /api/me',
    'GET /api/tracks', 'GET /api/tracks/:id', 'GET /api/tracks/:id/cover', 'GET /api/tracks/:id/stream',
    'GET /api/users/:username/playlists', 'GET /api/playlists/:id', 'POST /api/auth/login', 'POST /api/auth/logout',
    'POST /api/auth/register', 'POST /api/tracks/:id/play', 'POST /api/tracks/:id/report',
  ],
  user: [
    'DELETE /api/playlists/:id', 'DELETE /api/playlists/:id/tracks/:trackId', 'DELETE /api/tracks/:id', 'DELETE /api/tracks/:id/cover',
    'DELETE /api/tracks/:id/like', 'GET /api/me/export', 'GET /api/playlists', 'GET /api/tracks/mine', 'PATCH /api/me',
    'PATCH /api/playlists/:id', 'PATCH /api/tracks/:id', 'POST /api/me/delete', 'POST /api/me/password', 'POST /api/playlists',
    'POST /api/playlists/:id/tracks', 'POST /api/tracks', 'PUT /api/playlists/:id/order', 'PUT /api/tracks/:id/cover', 'PUT /api/tracks/:id/like',
  ],
  mod: [
    'GET /api/admin/reports', 'GET /api/admin/stats', 'GET /api/admin/tracks',
    'POST /api/admin/reports/:id/resolve', 'POST /api/admin/tracks/:id/status',
  ],
  admin: ['GET /api/admin/users', 'PATCH /api/admin/users/:id'],
};
const classOf = (route) => Object.keys(CLASSES).find((k) => CLASSES[k].includes(route));

describe('permission matrix', () => {
  let ctx; let admin; let mod; let alice; let bob; let trackId; let playlistId;
  before(async () => {
    ctx = await makeApp();
    admin = await register(ctx.app, 'admin1'); // first account is the administrator
    mod = await register(ctx.app, 'mod1');
    await call(ctx.app, 'PATCH', `/api/admin/users/${mod.user.id}`, { cookie: admin.cookie, body: { role: 'moderator' } });
    alice = await register(ctx.app, 'alice');
    bob = await register(ctx.app, 'bob');
    trackId = (await upload(ctx.app, alice.cookie, { title: 'Alice song' })).json.id;
    playlistId = (await call(ctx.app, 'POST', '/api/playlists', { cookie: alice.cookie, body: { name: 'Private', isPublic: false } })).json.id;
  });
  after(async () => { await ctx.close(); });

  const fill = (url) => url.replace(':id', trackId).replace(':trackId', trackId).replace(':username', 'alice');

  test('every API route is classified', () => {
    const api = [...new Set(ctx.app.routeList)].filter((r) => r.split(' ')[1].startsWith('/api/'));
    const missing = api.filter((r) => !classOf(r));
    assert.deepEqual(missing, [], 'classify new routes in CLASSES');
    const stale = Object.values(CLASSES).flat().filter((r) => !api.includes(r));
    assert.deepEqual(stale, [], 'classified routes that no longer exist');
  });

  test('anonymous, regular and moderator access follow the class of each route', async () => {
    const api = [...new Set(ctx.app.routeList)].filter((r) => r.split(' ')[1].startsWith('/api/'));
    for (const route of api) {
      const [method, rawUrl] = route.split(' ');
      const url = fill(rawUrl).replace('/playlists/' + trackId, '/playlists/' + playlistId);
      const cls = classOf(route);
      const anon = await call(ctx.app, method, url, { body: method === 'GET' ? undefined : {} });
      if (cls === 'public') assert.notEqual(anon.status, 401, `${route} must not need sign-in (got ${anon.status})`);
      else assert.equal(anon.status, 401, `${route} anonymous -> ${anon.status}`);
      if (cls === 'mod' || cls === 'admin') {
        const u = await call(ctx.app, method, url, { cookie: bob.cookie, body: method === 'GET' ? undefined : {} });
        assert.equal(u.status, 403, `${route} regular user -> ${u.status}`);
      }
      if (cls === 'admin') {
        const m = await call(ctx.app, method, url, { cookie: mod.cookie, body: method === 'GET' ? undefined : {} });
        assert.equal(m.status, 403, `${route} moderator -> ${m.status}`);
      }
    }
  });

  test('another user cannot change or read someone else\'s resources', async () => {
    const tryAll = async (list) => {
      for (const [method, url, body] of list) {
        const r = await call(ctx.app, method, url, { cookie: bob.cookie, body });
        assert.ok([403, 404].includes(r.status), `${method} ${url} as non-owner -> ${r.status}`);
      }
    };
    await tryAll([
      ['PATCH', `/api/tracks/${trackId}`, { title: 'hacked' }],
      ['DELETE', `/api/tracks/${trackId}`],
      ['PUT', `/api/tracks/${trackId}/cover`, {}],
      ['DELETE', `/api/tracks/${trackId}/cover`],
      ['GET', `/api/playlists/${playlistId}`],
      ['PATCH', `/api/playlists/${playlistId}`, { name: 'hacked' }],
      ['DELETE', `/api/playlists/${playlistId}`],
      ['POST', `/api/playlists/${playlistId}/tracks`, { trackId }],
      ['DELETE', `/api/playlists/${playlistId}/tracks/${trackId}`],
      ['PUT', `/api/playlists/${playlistId}/order`, { trackIds: [trackId] }],
    ]);
    const still = await call(ctx.app, 'GET', `/api/tracks/${trackId}`);
    assert.equal(still.json.title, 'Alice song');
    assert.equal((await call(ctx.app, 'GET', `/api/playlists/${playlistId}`, { cookie: alice.cookie })).json.name, 'Private');
  });

  test('removed and pending tracks are hidden from the public and from other users', async () => {
    assert.equal((await call(ctx.app, 'POST', `/api/admin/tracks/${trackId}/status`, { cookie: mod.cookie, body: { status: 'removed' } })).status, 200);
    for (const suffix of ['', '/stream']) {
      assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}${suffix}`)).status, 404, `anon ${suffix}`);
      assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}${suffix}`, { cookie: bob.cookie })).status, 404, `other user ${suffix}`);
      assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}${suffix}`, { cookie: alice.cookie })).status, 404, `owner ${suffix}`);
    }
    const list = await call(ctx.app, 'GET', '/api/tracks');
    assert.ok(!list.json.items.some((t) => t.id === trackId));
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`, { cookie: mod.cookie })).status, 200, 'moderators can still see it');
    await call(ctx.app, 'POST', `/api/admin/tracks/${trackId}/status`, { cookie: mod.cookie, body: { status: 'published' } });
  });

  test('state-changing requests need the CSRF header and a matching origin', async () => {
    const noHeader = await ctx.app.inject({ method: 'PATCH', url: '/api/me', headers: { cookie: alice.cookie, 'content-type': 'application/json' }, payload: '{"bio":"x"}' });
    assert.equal(noHeader.statusCode, 403);
    const badOrigin = await call(ctx.app, 'PATCH', '/api/me', { cookie: alice.cookie, body: { bio: 'x' }, headers: { origin: 'https://evil.example', host: 'localhost' } });
    assert.equal(badOrigin.status, 403);
    const ok = await call(ctx.app, 'PATCH', '/api/me', { cookie: alice.cookie, body: { bio: 'fine' } });
    assert.equal(ok.status, 200);
  });
});
