import { buildMatch } from './search.js';
import { isModerator } from './auth.js';

const SORTS = {
  new: 't.created_at DESC',
  popular: 't.plays DESC, t.created_at DESC',
  liked: 't.likes_count DESC, t.created_at DESC',
  title: 't.title COLLATE NOCASE ASC',
};

const BASE = `
  SELECT t.*, u.username AS artist_username, u.display_name AS artist_name,
         CASE WHEN @viewer IS NULL THEN 0
              ELSE EXISTS (SELECT 1 FROM likes l WHERE l.track_id = t.id AND l.user_id = @viewer) END AS liked
    FROM tracks t JOIN users u ON u.id = t.user_id`;

export function serializeTrack(row, { detail = false } = {}) {
  const out = {
    id: row.id,
    title: row.title,
    genre: row.genre,
    model: row.model,
    prompt: row.prompt,
    license: row.license,
    duration: row.duration,
    plays: row.plays,
    likes: row.likes_count,
    liked: !!row.liked,
    status: row.status,
    createdAt: row.created_at,
    hasCover: !!row.has_cover,
    coverUrl: `/api/tracks/${row.id}/cover?v=${row.updated_at}`,
    audioUrl: `/api/tracks/${row.id}/stream`,
    artist: { username: row.artist_username, displayName: row.artist_name },
    userId: row.user_id,
  };
  if (detail) {
    out.lyrics = row.lyrics;
    try { out.peaks = JSON.parse(row.peaks); } catch { out.peaks = []; }
  }
  return out;
}

export function canView(row, viewer) {
  if (!row) return false;
  if (row.status === 'published') return true;
  if (!viewer) return false;
  if (isModerator(viewer)) return true;
  return row.user_id === viewer.id && row.status !== 'removed';
}

export function getTrackRow(db, id, viewer) {
  return db.prepare(`${BASE} WHERE t.id = @id`).get({ id, viewer: viewer?.id ?? null });
}

/**
 * Lists tracks visible to the public (published only). Options: q (full text), sort, genre,
 * artist (username), likedBy (user id), limit, offset.
 */
export function listTracks(db, viewer, opts = {}) {
  const where = [`t.status = 'published'`];
  const params = { viewer: viewer?.id ?? null };
  let join = '';
  if (opts.q) {
    const match = buildMatch(opts.q);
    if (!match) return { items: [], total: 0 };
    join = ' JOIN (SELECT DISTINCT track_id FROM tracks_fts WHERE tracks_fts MATCH @match) f ON f.track_id = t.id';
    params.match = match;
  }
  if (opts.genre) { where.push('t.genre = @genre COLLATE NOCASE'); params.genre = opts.genre; }
  if (opts.artist) { where.push('u.username = @artist'); params.artist = opts.artist; }
  if (opts.likedBy) {
    where.push('EXISTS (SELECT 1 FROM likes lk WHERE lk.track_id = t.id AND lk.user_id = @likedBy)');
    params.likedBy = opts.likedBy;
  }
  const order = SORTS[opts.sort] || SORTS.new;
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const sqlWhere = ` WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM tracks t JOIN users u ON u.id = t.user_id${join}${sqlWhere}`)
    .get(params).n;
  const rows = db.prepare(`${BASE}${join}${sqlWhere} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`).all(params);
  return { items: rows.map((r) => serializeTrack(r)), total };
}

/** The viewer's own tracks of any status except removed (moderators handle removed ones). */
export function listOwnTracks(db, viewer) {
  const rows = db.prepare(`${BASE} WHERE t.user_id = @viewer AND t.status != 'removed' ORDER BY t.created_at DESC`)
    .all({ viewer: viewer.id });
  return rows.map((r) => serializeTrack(r));
}
