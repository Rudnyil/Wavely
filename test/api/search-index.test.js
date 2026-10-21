import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../../server/db.js';
import { ftsUpsert, ftsDelete, buildMatch } from '../../server/search.js';

function setup() {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES ('a','A','x','user',1)").run();
  return db;
}
const hits = (db, q) => db.prepare('SELECT DISTINCT track_id FROM tracks_fts WHERE tracks_fts MATCH ?').all(buildMatch(q)).map((r) => r.track_id).sort();

test('upsert replaces the old text, delete removes it, and ids never collide', () => {
  const db = setup();
  ftsUpsert(db, { id: 'track_a', title: 'Neon Rain', prompt: 'p' }, 'A');
  ftsUpsert(db, { id: 'track_b', title: 'Neon Dawn', prompt: 'p' }, 'A');
  assert.deepEqual(hits(db, 'neon'), ['track_a', 'track_b']);
  ftsUpsert(db, { id: 'track_a', title: 'Ocean Drift', prompt: 'p' }, 'A');
  assert.deepEqual(hits(db, 'neon'), ['track_b']);
  assert.deepEqual(hits(db, 'ocean'), ['track_a']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks_fts').get().n, 2);
  ftsDelete(db, 'track_b');
  assert.deepEqual(hits(db, 'neon'), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks_fts_map').get().n, 1);
  ftsDelete(db, 'unknown'); // no-op
  ftsUpsert(db, { id: 'track_c', title: 'Neon again', prompt: 'p' }, 'A');
  assert.deepEqual(hits(db, 'neon'), ['track_c']);
});

test('migration 2 maps rows that already exist in a version 1 database', () => {
  const db = setup();
  ftsUpsert(db, { id: 'old_one', title: 'Legacy Song', prompt: 'p' }, 'A');
  ftsUpsert(db, { id: 'old_two', title: 'Legacy Tune', prompt: 'p' }, 'A');
  // Pretend this database was written by version 1: no map table.
  db.exec(`DROP TABLE tracks_fts_map;
    DROP INDEX idx_tracks_status_plays; DROP INDEX idx_tracks_status_likes; DROP INDEX idx_tracks_status_title;
    DROP INDEX idx_tracks_status_genre; DROP INDEX idx_tracks_user_status;
    CREATE INDEX idx_tracks_status_plays ON tracks(status, plays DESC);`);
  db.pragma('user_version = 1');
  migrate(db);
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks_fts_map').get().n, 2);
  ftsUpsert(db, { id: 'old_one', title: 'Renamed Song', prompt: 'p' }, 'A');
  assert.deepEqual(hits(db, 'legacy'), ['old_two']);
  assert.deepEqual(hits(db, 'renamed'), ['old_one']);
  ftsDelete(db, 'old_two');
  assert.deepEqual(hits(db, 'legacy'), []);
});
