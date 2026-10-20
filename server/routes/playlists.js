import { badRequest, forbidden, notFound } from '../errors.js';
import { isModerator, requireUser } from '../auth.js';
import { serializeTrack } from '../repo.js';
import { cleanText, newId, now } from '../util.js';

const TRACK_SELECT = `
  SELECT t.*, u.username AS artist_username, u.display_name AS artist_name,
         CASE WHEN @viewer IS NULL THEN 0
              ELSE EXISTS (SELECT 1 FROM likes l WHERE l.track_id = t.id AND l.user_id = @viewer) END AS liked
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id AND t.status = 'published'
    JOIN users u ON u.id = t.user_id
   WHERE pt.playlist_id = @pid
   ORDER BY pt.position`;

export default async function playlistRoutes(app) {
  const { db } = app;
  const MAX_PLAYLISTS = 100;
  const MAX_TRACKS = 1000;

  const summary = (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    isPublic: !!p.is_public,
    owner: { username: p.owner_username, displayName: p.owner_name },
    tracks: p.track_count,
    updatedAt: p.updated_at,
  });

  const SUMMARY = `
    SELECT p.*, u.username AS owner_username, u.display_name AS owner_name,
           (SELECT COUNT(*) FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id AND t.status = 'published'
             WHERE pt.playlist_id = p.id) AS track_count
      FROM playlists p JOIN users u ON u.id = p.user_id`;

  function visiblePlaylist(req, id) {
    const p = db.prepare(`${SUMMARY} WHERE p.id = ?`).get(String(id));
    if (!p) throw notFound('Playlist not found');
    if (!p.is_public && p.user_id !== req.user?.id && !isModerator(req.user)) throw notFound('Playlist not found');
    return p;
  }

  function ownPlaylist(req, id) {
    const user = requireUser(req);
    const p = db.prepare(`${SUMMARY} WHERE p.id = ?`).get(String(id));
    if (!p || p.user_id !== user.id) {
      if (p && p.is_public) throw forbidden();
      throw notFound('Playlist not found');
    }
    return p;
  }

  const full = (req, p) => ({
    ...summary(p),
    items: db.prepare(TRACK_SELECT).all({ viewer: req.user?.id ?? null, pid: p.id }).map((r) => serializeTrack(r)),
  });

  app.get('/api/playlists', async (req) => {
    const user = requireUser(req);
    const rows = db.prepare(`${SUMMARY} WHERE p.user_id = ? ORDER BY p.updated_at DESC`).all(user.id);
    return { items: rows.map(summary) };
  });

  app.get('/api/users/:username/playlists', async (req) => {
    const rows = db.prepare(`${SUMMARY} WHERE u.username = ? AND p.is_public = 1 ORDER BY p.updated_at DESC`)
      .all(String(req.params.username));
    return { items: rows.map(summary) };
  });

  app.post('/api/playlists', async (req, reply) => {
    const user = requireUser(req);
    const body = req.body || {};
    const name = cleanText(body.name, 80);
    if (!name) throw badRequest('invalid_name', 'Playlist name is required');
    const count = db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id = ?').get(user.id).n;
    if (count >= MAX_PLAYLISTS) throw badRequest('limit_reached', `You can have at most ${MAX_PLAYLISTS} playlists`);
    const id = newId();
    const t = now();
    db.prepare('INSERT INTO playlists (id, user_id, name, description, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, user.id, name, cleanText(body.description, 500), body.isPublic ? 1 : 0, t, t);
    return reply.code(201).send(full(req, visiblePlaylist(req, id)));
  });

  app.get('/api/playlists/:id', async (req) => full(req, visiblePlaylist(req, req.params.id)));

  app.patch('/api/playlists/:id', async (req) => {
    const p = ownPlaylist(req, req.params.id);
    const body = req.body || {};
    const name = body.name === undefined ? p.name : cleanText(body.name, 80);
    if (!name) throw badRequest('invalid_name', 'Playlist name is required');
    const description = body.description === undefined ? p.description : cleanText(body.description, 500);
    const isPublic = body.isPublic === undefined ? p.is_public : body.isPublic ? 1 : 0;
    db.prepare('UPDATE playlists SET name=?, description=?, is_public=?, updated_at=? WHERE id=?')
      .run(name, description, isPublic, now(), p.id);
    return full(req, visiblePlaylist(req, p.id));
  });

  app.delete('/api/playlists/:id', async (req) => {
    const p = ownPlaylist(req, req.params.id);
    db.prepare('DELETE FROM playlists WHERE id = ?').run(p.id);
    return { ok: true };
  });

  app.post('/api/playlists/:id/tracks', async (req, reply) => {
    const p = ownPlaylist(req, req.params.id);
    const trackId = String(req.body?.trackId ?? '');
    const track = db.prepare("SELECT id FROM tracks WHERE id = ? AND status = 'published'").get(trackId);
    if (!track) throw notFound('Track not found');
    const count = db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?').get(p.id).n;
    if (count >= MAX_TRACKS) throw badRequest('limit_reached', `A playlist can hold at most ${MAX_TRACKS} tracks`);
    db.transaction(() => {
      const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM playlist_tracks WHERE playlist_id = ?').get(p.id).n;
      db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?,?,?,?)')
        .run(p.id, track.id, pos, now());
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), p.id);
    })();
    return reply.code(201).send(full(req, visiblePlaylist(req, p.id)));
  });

  app.delete('/api/playlists/:id/tracks/:trackId', async (req) => {
    const p = ownPlaylist(req, req.params.id);
    db.transaction(() => {
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(p.id, String(req.params.trackId));
      const rows = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(p.id);
      const upd = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
      rows.forEach((r, i) => upd.run(i, p.id, r.track_id));
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), p.id);
    })();
    return full(req, visiblePlaylist(req, p.id));
  });

  app.put('/api/playlists/:id/order', async (req) => {
    const p = ownPlaylist(req, req.params.id);
    const ids = req.body?.trackIds;
    if (!Array.isArray(ids)) throw badRequest('invalid_order', 'trackIds must be an array');
    const current = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ?').all(p.id).map((r) => r.track_id);
    const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((i) => current.includes(i));
    if (!same) throw badRequest('invalid_order', 'trackIds must list every track in the playlist exactly once');
    db.transaction(() => {
      const upd = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?');
      ids.forEach((id, i) => upd.run(i, p.id, id));
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now(), p.id);
    })();
    return full(req, visiblePlaylist(req, p.id));
  });
}
