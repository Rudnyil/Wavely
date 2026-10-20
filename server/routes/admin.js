import { ApiError, badRequest, notFound } from '../errors.js';
import { requireAdmin, requireModerator } from '../auth.js';
import { serializeTrack } from '../repo.js';
import { clampInt, now } from '../util.js';

const TRACK_BY_STATUS = `
  SELECT t.*, u.username AS artist_username, u.display_name AS artist_name, 0 AS liked
    FROM tracks t JOIN users u ON u.id = t.user_id
   WHERE t.status = ? ORDER BY t.updated_at DESC LIMIT 200`;

export default async function adminRoutes(app) {
  const { db } = app;

  app.get('/api/admin/stats', async (req) => {
    requireModerator(req);
    const one = (sql) => db.prepare(sql).get().n;
    return {
      users: one('SELECT COUNT(*) AS n FROM users'),
      tracks: one("SELECT COUNT(*) AS n FROM tracks WHERE status = 'published'"),
      pending: one("SELECT COUNT(*) AS n FROM tracks WHERE status = 'pending'"),
      removed: one("SELECT COUNT(*) AS n FROM tracks WHERE status = 'removed'"),
      openReports: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      plays: one('SELECT COALESCE(SUM(plays),0) AS n FROM tracks'),
      storageBytes: one('SELECT COALESCE(SUM(audio_bytes),0) AS n FROM tracks'),
    };
  });

  app.get('/api/admin/reports', async (req) => {
    requireModerator(req);
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';
    const rows = db.prepare(
      `SELECT r.id, r.reason, r.details, r.contact, r.status, r.resolution, r.created_at AS createdAt,
              r.resolved_at AS resolvedAt, t.id AS trackId, t.title AS trackTitle, t.status AS trackStatus,
              u.username AS artist, ru.username AS reporter
         FROM reports r JOIN tracks t ON t.id = r.track_id JOIN users u ON u.id = t.user_id
         LEFT JOIN users ru ON ru.id = r.reporter_id
        WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`,
    ).all(status);
    return { items: rows };
  });

  app.post('/api/admin/reports/:id/resolve', async (req) => {
    const mod = requireModerator(req);
    const resolution = req.body?.resolution;
    if (!['dismissed', 'removed'].includes(resolution)) {
      throw badRequest('invalid_resolution', 'resolution must be dismissed or removed');
    }
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(Number(req.params.id));
    if (!report) throw notFound('Report not found');
    const t = now();
    db.transaction(() => {
      // Resolving a report resolves every open report about the same track.
      db.prepare(
        `UPDATE reports SET status='resolved', resolution=?, resolved_by=?, resolved_at=?
          WHERE track_id = ? AND status = 'open'`,
      ).run(resolution, mod.id, t, report.track_id);
      if (resolution === 'removed') {
        db.prepare("UPDATE tracks SET status='removed', updated_at=? WHERE id=?").run(t, report.track_id);
      }
    })();
    return { ok: true };
  });

  app.get('/api/admin/tracks', async (req) => {
    requireModerator(req);
    const status = ['pending', 'removed'].includes(req.query.status) ? req.query.status : 'pending';
    return { items: db.prepare(TRACK_BY_STATUS).all(status).map((r) => serializeTrack(r)) };
  });

  app.post('/api/admin/tracks/:id/status', async (req) => {
    requireModerator(req);
    const status = req.body?.status;
    if (!['published', 'removed'].includes(status)) throw badRequest('invalid_status', 'status must be published or removed');
    const info = db.prepare('UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), String(req.params.id));
    if (!info.changes) throw notFound('Track not found');
    return { ok: true };
  });

  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const like = `%${String(req.query.q ?? '').replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 60)}%`;
    const limit = clampInt(req.query.limit, 100, 1, 200);
    const rows = db.prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.role, u.disabled, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id) AS tracks
         FROM users u WHERE u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
        ORDER BY u.created_at DESC LIMIT ?`,
    ).all(like, like, limit);
    return { items: rows.map((r) => ({ ...r, disabled: !!r.disabled })) };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const id = Number(req.params.id);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) throw notFound('User not found');
    const body = req.body || {};
    let role = target.role;
    let disabled = target.disabled;
    if (body.role !== undefined) {
      if (!['user', 'moderator', 'admin'].includes(body.role)) throw badRequest('invalid_role', 'Invalid role');
      role = body.role;
    }
    if (body.disabled !== undefined) disabled = body.disabled ? 1 : 0;
    if (id === admin.id && (role !== 'admin' || disabled)) {
      throw new ApiError(409, 'self_lockout', 'You cannot demote or disable yourself');
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET role = ?, disabled = ? WHERE id = ?').run(role, disabled, id);
      if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    })();
    return { ok: true };
  });
}
