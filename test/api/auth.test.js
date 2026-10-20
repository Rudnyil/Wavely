import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, register, sessionCookie } from '../helpers.js';

describe('auth', () => {
  let ctx;
  before(async () => { ctx = await makeApp(); });
  after(async () => { await ctx.close(); });

  test('first registered user becomes admin, next ones are users', async () => {
    const a = await register(ctx.app, 'alice');
    const b = await register(ctx.app, 'bob');
    assert.equal(a.user.role, 'admin');
    assert.equal(b.user.role, 'user');
  });

  test('config reports needsSetup before first user', async () => {
    const fresh = await makeApp();
    try {
      assert.equal((await call(fresh.app, 'GET', '/api/config')).json.needsSetup, true);
      await register(fresh.app, 'first');
      assert.equal((await call(fresh.app, 'GET', '/api/config')).json.needsSetup, false);
    } finally { await fresh.close(); }
  });

  test('rejects invalid usernames and short passwords', async () => {
    for (const username of ['ab', 'has space', 'ünicode', 'a'.repeat(25), "x'; DROP TABLE users;--"]) {
      const r = await call(ctx.app, 'POST', '/api/auth/register', { body: { username, password: 'longenough1' } });
      assert.equal(r.status, 400, username);
      assert.equal(r.json.error.code, 'invalid_username');
    }
    const r = await call(ctx.app, 'POST', '/api/auth/register', { body: { username: 'shorty', password: 'short' } });
    assert.equal(r.json.error.code, 'invalid_password');
  });

  test('usernames are unique case-insensitively', async () => {
    await register(ctx.app, 'Carol');
    const r = await call(ctx.app, 'POST', '/api/auth/register', { body: { username: 'carol', password: 'correct horse battery' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'username_taken');
  });

  test('login, session lookup, logout', async () => {
    await register(ctx.app, 'dave');
    const bad = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'dave', password: 'wrong password' } });
    assert.equal(bad.status, 401);
    const unknown = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'nobody', password: 'wrong password' } });
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.json, bad.json, 'same error for unknown user and wrong password');

    const ok = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'DAVE', password: 'correct horse battery' } });
    assert.equal(ok.status, 200);
    const cookie = sessionCookie(ok);
    assert.match(ok.headers['set-cookie'], /HttpOnly/i);
    assert.match(ok.headers['set-cookie'], /SameSite=Lax/i);
    assert.equal((await call(ctx.app, 'GET', '/api/me', { cookie })).json.user.username, 'dave');

    await call(ctx.app, 'POST', '/api/auth/logout', { cookie, body: {} });
    assert.equal((await call(ctx.app, 'GET', '/api/me', { cookie })).json.user, null);
  });

  test('anonymous /api/me returns user: null with 200', async () => {
    const r = await call(ctx.app, 'GET', '/api/me');
    assert.equal(r.status, 200);
    assert.equal(r.json.user, null);
  });

  test('password is stored hashed and session tokens are stored hashed', async () => {
    const u = await register(ctx.app, 'erin');
    const row = ctx.db.prepare('SELECT password_hash FROM users WHERE username = ?').get('erin');
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes('correct horse'));
    const token = u.cookie.split('=')[1];
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(token).n, 0);
  });

  test('changing password invalidates other sessions', async () => {
    const u = await register(ctx.app, 'frank');
    const second = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'frank', password: 'correct horse battery' } });
    const other = sessionCookie(second);
    const wrong = await call(ctx.app, 'POST', '/api/me/password', { cookie: u.cookie, body: { current: 'nope nope nope', next: 'brand new password' } });
    assert.equal(wrong.status, 403);
    const ch = await call(ctx.app, 'POST', '/api/me/password', { cookie: u.cookie, body: { current: 'correct horse battery', next: 'brand new password' } });
    assert.equal(ch.status, 200);
    assert.equal((await call(ctx.app, 'GET', '/api/me', { cookie: other })).json.user, null);
    const fresh = sessionCookie(ch);
    assert.equal((await call(ctx.app, 'GET', '/api/me', { cookie: fresh })).json.user.username, 'frank');
    const relog = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'frank', password: 'brand new password' } });
    assert.equal(relog.status, 200);
  });

  test('profile update sanitizes text', async () => {
    const u = await register(ctx.app, 'gina');
    const r = await call(ctx.app, 'PATCH', '/api/me', { cookie: u.cookie, body: { displayName: '  Gi‮na\u0000  ', bio: 'Hello' } });
    assert.equal(r.json.user.displayName, 'Gina');
    const empty = await call(ctx.app, 'PATCH', '/api/me', { cookie: u.cookie, body: { displayName: '   ' } });
    assert.equal(empty.status, 400);
  });

  test('expired sessions are rejected', async () => {
    const u = await register(ctx.app, 'hank');
    ctx.db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?').run(u.user.id);
    assert.equal((await call(ctx.app, 'GET', '/api/me', { cookie: u.cookie })).json.user, null);
  });

  test('disabled users cannot log in and lose sessions', async () => {
    const admin = (await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'alice', password: 'correct horse battery' } }));
    const adminCookie = sessionCookie(admin);
    const u = await register(ctx.app, 'ivy');
    const r = await call(ctx.app, 'PATCH', `/api/admin/users/${u.user.id}`, { cookie: adminCookie, body: { disabled: true } });
    assert.equal(r.status, 200);
    assert.equal((await call(ctx.app, 'GET', '/api/me', { cookie: u.cookie })).json.user, null);
    const login = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'ivy', password: 'correct horse battery' } });
    assert.equal(login.status, 401);
  });

  test('account export contains the user data, deletion removes everything', async () => {
    const u = await register(ctx.app, 'jack');
    const exp = await call(ctx.app, 'GET', '/api/me/export', { cookie: u.cookie });
    assert.equal(exp.json.user.username, 'jack');
    const bad = await call(ctx.app, 'POST', '/api/me/delete', { cookie: u.cookie, body: { password: 'incorrect' } });
    assert.equal(bad.status, 403);
    const del = await call(ctx.app, 'POST', '/api/me/delete', { cookie: u.cookie, body: { password: 'correct horse battery' } });
    assert.equal(del.status, 200);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').get('jack').n, 0);
  });

  test('last administrator cannot delete their account', async () => {
    const solo = await makeApp();
    try {
      const a = await register(solo.app, 'only');
      const r = await call(solo.app, 'POST', '/api/me/delete', { cookie: a.cookie, body: { password: 'correct horse battery' } });
      assert.equal(r.status, 409);
      assert.equal(r.json.error.code, 'last_admin');
    } finally { await solo.close(); }
  });
});

describe('registration modes', () => {
  test('closed: only the very first account can be created', async () => {
    const c = await makeApp({ REGISTRATION: 'closed' });
    try {
      await register(c.app, 'owner');
      const r = await call(c.app, 'POST', '/api/auth/register', { body: { username: 'late', password: 'correct horse battery' } });
      assert.equal(r.status, 403);
      assert.equal(r.json.error.code, 'registration_closed');
    } finally { await c.close(); }
  });

  test('invite: requires the right code', async () => {
    const c = await makeApp({ REGISTRATION: 'invite', INVITE_CODE: 's3cret-code' });
    try {
      await register(c.app, 'owner');
      const no = await call(c.app, 'POST', '/api/auth/register', { body: { username: 'guest', password: 'correct horse battery' } });
      assert.equal(no.status, 403);
      const wrong = await call(c.app, 'POST', '/api/auth/register', { body: { username: 'guest', password: 'correct horse battery', inviteCode: 'nope' } });
      assert.equal(wrong.json.error.code, 'invalid_invite');
      const ok = await call(c.app, 'POST', '/api/auth/register', { body: { username: 'guest', password: 'correct horse battery', inviteCode: 's3cret-code' } });
      assert.equal(ok.status, 201);
    } finally { await c.close(); }
  });

  test('invite mode without INVITE_CODE fails fast', async () => {
    await assert.rejects(() => makeApp({ REGISTRATION: 'invite' }), /INVITE_CODE/);
  });
});
