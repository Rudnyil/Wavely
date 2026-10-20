/** Builds a safe FTS5 MATCH expression from free text: every word becomes a quoted prefix token. */
export function buildMatch(query) {
  const tokens = String(query || '').normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];
  const unique = [...new Set(tokens.map((t) => t.toLowerCase()))].slice(0, 8);
  if (!unique.length) return null;
  return unique.map((t) => `"${t}"*`).join(' ');
}

export function ftsUpsert(db, track, artist) {
  db.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(track.id);
  db.prepare('INSERT INTO tracks_fts (track_id, title, artist, genre, prompt, lyrics) VALUES (?,?,?,?,?,?)')
    .run(track.id, track.title, artist, track.genre || '', track.prompt || '', track.lyrics || '');
}

export function ftsDelete(db, id) {
  db.prepare('DELETE FROM tracks_fts WHERE track_id = ?').run(id);
}

export function ftsReindexUser(db, userId) {
  const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const rows = db.prepare('SELECT id, title, genre, prompt, lyrics FROM tracks WHERE user_id = ?').all(userId);
  for (const t of rows) ftsUpsert(db, t, `${user.display_name} ${user.username}`);
}
