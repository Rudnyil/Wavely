import { ApiError, badRequest } from '../errors.js';
import {
  COOKIE_NAME, clearSessionCookie, createSession, destroySession, hashPassword, requireUser,
  setSessionCookie, validatePassword, validateUsername, verifyDummy, verifyPassword,
} from '../auth.js';
import { cleanText, now, timingSafeEqualStr } from '../util.js';
import { ftsReindexUser, ftsDelete } from '../search.js';

const publicUser = (u) => ({
  id: u.id, username: u.username, displayName: u.display_name, role: u.role, bio: u.bio, createdAt: u.created_at,
});

const limit = (max, timeWindow) => ({ config: { rateLimit: { max, timeWindow } } });

export default async function authRoutes(app) {
  const { db, config, storage } = app;

  app.post('/api/auth/register', limit(10, '1 hour'), async (req, reply) => {
    const body = req.body || {};
    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const first = userCount === 0;
    if (!first) {
      if (config.registration === 'closed') throw new ApiError(403, 'registration_closed', 'Registration is closed');
      if (config.registration === 'invite' && !timingSafeEqualStr(String(body.inviteCode ?? ''), config.inviteCode)) {
        throw new ApiError(403, 'invalid_invite', 'Invalid invite code');
      }
    }
    const username = String(body.username ?? '').trim();
    if (!validateUsername(username)) {
      throw badRequest('invalid_username', 'Username must be 3-24 characters: letters, digits or underscore');
    }
    if (!validatePassword(body.password)) throw badRequest('invalid_password', 'Password must be 8-200 characters');
    const displayName = cleanText(body.displayName, 40) || username;
    const hash = await hashPassword(body.password);
    let id;
    try {
      const info = db.prepare(
        'INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?)',
      ).run(username, displayName, hash, first ? 'admin' : 'user', now());
      id = Number(info.lastInsertRowid);
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw new ApiError(409, 'username_taken', 'This username is already taken');
      throw e;
    }
    setSessionCookie(reply, config, createSession(db, config, id));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post('/api/auth/login', limit(30, '15 minutes'), async (req, reply) => {
    const { username = '', password = '' } = req.body || {};
    const name = String(username).trim();
    if (typeof password !== 'string' || !name) throw badRequest('invalid_credentials', 'Enter username and password');
    if (app.loginThrottle.blocked(name)) {
      throw new ApiError(429, 'rate_limited', 'Too many failed attempts, try again later');
    }
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
    let ok = false;
    if (row) ok = await verifyPassword(password, row.password_hash);
    else await verifyDummy(password);
    if (!ok || row.disabled) {
      app.loginThrottle.fail(name);
      throw new ApiError(401, 'invalid_credentials', 'Wrong username or password');
    }
    app.loginThrottle.reset(name);
    setSessionCookie(reply, config, createSession(db, config, row.id));
    return { user: publicUser(row) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(db, req.cookies?.[COOKIE_NAME]);
    clearSessionCookie(reply, config);
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ user: req.user ? publicUser(req.user) : null }));

  app.patch('/api/me', async (req) => {
    const user = requireUser(req);
    const body = req.body || {};
    const displayName = body.displayName === undefined ? user.display_name : cleanText(body.displayName, 40);
    const bio = body.bio === undefined ? user.bio : cleanText(body.bio, 500);
    if (!displayName) throw badRequest('invalid_name', 'Display name cannot be empty');
    db.transaction(() => {
      db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(displayName, bio, user.id);
      ftsReindexUser(db, user.id);
    })();
    return { user: publicUser({ ...user, display_name: displayName, bio }) };
  });

  app.post('/api/me/password', limit(10, '15 minutes'), async (req, reply) => {
    const user = requireUser(req);
    const { current, next } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (typeof current !== 'string' || !(await verifyPassword(current, row.password_hash))) {
      throw new ApiError(403, 'wrong_password', 'Current password is wrong');
    }
    if (!validatePassword(next)) throw badRequest('invalid_password', 'Password must be 8-200 characters');
    const hash = await hashPassword(next);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    })();
    setSessionCookie(reply, config, createSession(db, config, user.id));
    return { ok: true };
  });

  // Everything the service stores about the account, as JSON (data portability).
  app.get('/api/me/export', async (req, reply) => {
    const user = requireUser(req);
    const data = {
      exportedAt: new Date().toISOString(),
      user: publicUser(user),
      tracks: db.prepare('SELECT id, title, genre, model, prompt, lyrics, license, duration, status, plays, created_at FROM tracks WHERE user_id = ?').all(user.id),
      likes: db.prepare('SELECT track_id, created_at FROM likes WHERE user_id = ?').all(user.id),
      playlists: db.prepare('SELECT id, name, description, is_public, created_at FROM playlists WHERE user_id = ?').all(user.id)
        .map((p) => ({ ...p, tracks: db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(p.id).map((r) => r.track_id) })),
    };
    reply.header('Content-Disposition', `attachment; filename="wavely-${user.username}.json"`);
    return data;
  });

  app.post('/api/me/delete', limit(5, '15 minutes'), async (req, reply) => {
    const user = requireUser(req);
    const row = db.prepare('SELECT password_hash, role FROM users WHERE id = ?').get(user.id);
    if (typeof req.body?.password !== 'string' || !(await verifyPassword(req.body.password, row.password_hash))) {
      throw new ApiError(403, 'wrong_password', 'Password is wrong');
    }
    if (row.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
      if (admins <= 1) throw new ApiError(409, 'last_admin', 'You are the only administrator. Promote someone else first.');
    }
    const ids = db.prepare('SELECT id FROM tracks WHERE user_id = ?').all(user.id).map((r) => r.id);
    db.transaction(() => {
      for (const id of ids) ftsDelete(db, id);
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    })();
    for (const id of ids) storage.remove(id);
    clearSessionCookie(reply, config);
    return { ok: true };
  });
}
