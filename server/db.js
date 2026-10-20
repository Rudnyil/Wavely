import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Schema migrations. Each entry runs once, in order; the index + 1 is stored in
 * PRAGMA user_version. Never edit a shipped migration, add a new one instead.
 */
const MIGRATIONS = [
  /* 1: initial schema */ `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
    bio           TEXT    NOT NULL DEFAULT '',
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE tracks (
    id          TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    genre       TEXT    NOT NULL DEFAULT '',
    model       TEXT    NOT NULL DEFAULT '',
    prompt      TEXT    NOT NULL,
    lyrics      TEXT    NOT NULL DEFAULT '',
    license     TEXT    NOT NULL CHECK (license IN ('commercial','non_commercial')),
    duration    REAL    NOT NULL,
    audio_bytes INTEGER NOT NULL,
    peaks       TEXT    NOT NULL DEFAULT '[]',
    has_cover   INTEGER NOT NULL DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending','removed')),
    plays       INTEGER NOT NULL DEFAULT 0,
    likes_count INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_tracks_user ON tracks(user_id);
  CREATE INDEX idx_tracks_status_created ON tracks(status, created_at DESC);
  CREATE INDEX idx_tracks_status_plays ON tracks(status, plays DESC);

  CREATE VIRTUAL TABLE tracks_fts USING fts5(
    track_id UNINDEXED, title, artist, genre, prompt, lyrics,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE likes (
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    track_id   TEXT    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );
  CREATE INDEX idx_likes_track ON likes(track_id);

  CREATE TABLE playlists (
    id          TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    is_public   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX idx_playlists_user ON playlists(user_id);

  CREATE TABLE playlist_tracks (
    playlist_id TEXT    NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    TEXT    NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
  );
  CREATE INDEX idx_playlist_tracks_pos ON playlist_tracks(playlist_id, position);

  CREATE TABLE reports (
    id          INTEGER PRIMARY KEY,
    track_id    TEXT    NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason      TEXT    NOT NULL CHECK (reason IN ('copyright','voice_imitation','not_ai','abuse','other')),
    details     TEXT    NOT NULL DEFAULT '',
    contact     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    resolution  TEXT    CHECK (resolution IN ('dismissed','removed')),
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX idx_reports_status ON reports(status, created_at DESC);
  CREATE INDEX idx_reports_track ON reports(track_id);

  CREATE TABLE plays_recent (
    track_id TEXT    NOT NULL,
    key      TEXT    NOT NULL,
    at       INTEGER NOT NULL
  );
  CREATE INDEX idx_plays_recent ON plays_recent(track_id, key, at);
  CREATE INDEX idx_plays_recent_at ON plays_recent(at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema (v${current}) is newer than this version of Wavely (v${MIGRATIONS.length}). Upgrade Wavely.`);
  }
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
