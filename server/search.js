/** Builds a safe FTS5 MATCH expression from free text: every word becomes a quoted prefix token. */
export function buildMatch(query) {
  const tokens = String(query || '').normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()))].slice(0, 8);
  if (!unique.length) return null;
  return unique.map((t) => `"${t}"*`).join(' ');
}

/** Adds or replaces the search row of a track. tracks_fts_map gives its rowid, so no full scan is needed. */
export function ftsUpsert(db, track, artist) {
  const mapped = db.prepare('SELECT fts_rowid FROM tracks_fts_map WHERE track_id = ?').get(track.id);
  if (mapped) db.prepare('DELETE FROM tracks_fts WHERE rowid = ?').run(mapped.fts_rowid);
  const info = db.prepare('INSERT INTO tracks_fts (rowid, track_id, title, artist, genre, prompt, lyrics) VALUES (?,?,?,?,?,?,?)')
    .run(mapped ? mapped.fts_rowid : null, track.id, track.title, artist, track.genre || '', track.prompt || '', track.lyrics || '');
  if (!mapped) db.prepare('INSERT INTO tracks_fts_map (track_id, fts_rowid) VALUES (?,?)').run(track.id, info.lastInsertRowid);
}

export function ftsDelete(db, id) {
  const mapped = db.prepare('SELECT fts_rowid FROM tracks_fts_map WHERE track_id = ?').get(id);
  if (!mapped) return;
  db.prepare('DELETE FROM tracks_fts WHERE rowid = ?').run(mapped.fts_rowid);
  db.prepare('DELETE FROM tracks_fts_map WHERE track_id = ?').run(id);
}

export function ftsReindexUser(db, userId) {
  const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const rows = db.prepare('SELECT id, title, genre, prompt, lyrics FROM tracks WHERE user_id = ?').all(userId);
  for (const t of rows) ftsUpsert(db, t, `${user.display_name} ${user.username}`);
}
