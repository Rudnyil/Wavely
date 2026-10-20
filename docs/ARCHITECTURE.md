# Architecture

```
browser (Preact + htm, ES modules, no build) ──HTTP──▶ Fastify 5
                                                        ├─ routes/        auth, tracks, playlists, admin, meta
                                                        ├─ auth.js        scrypt, sessions, CSRF, throttling
                                                        ├─ media.js       ffprobe / ffmpeg (spawned, no shell)
                                                        ├─ db.js          SQLite (better-sqlite3), migrations
                                                        └─ storage.js     DATA_DIR/audio, covers, tmp
```

## Server (`server/`)

| File | Role |
|---|---|
| `index.js` | Process entry: config, database, listen, graceful shutdown |
| `app.js` | `buildApp({config, db})`: plugins, hooks (CSRF, session lookup, security headers), static files, SPA fallback, error handler. Tests build the app directly |
| `config.js` | Parses and validates environment variables, fails fast |
| `db.js` | Opens SQLite (WAL, foreign keys) and applies `MIGRATIONS` in order, tracked in `PRAGMA user_version` |
| `auth.js` | Password hashing, sessions, role helpers, CSRF hook, failed-login throttle |
| `media.js` | Probing, MP3 transcoding, waveform peaks, cover processing, concurrency limit |
| `repo.js`, `search.js` | Track queries/serialisation and the FTS5 index |
| `stream.js` | Single-range `Range` implementation with `ETag`/304 |
| `routes/*.js` | HTTP handlers, grouped by area |
| `cli.js` | `create-admin` |

### Data model

`users` → `sessions`, `tracks` (→ `likes`, `playlist_tracks`, `reports`), `playlists`, `plays_recent` (30-minute play de-duplication), `tracks_fts` (FTS5: title, artist, genre, prompt, lyrics). Deleting a user or track cascades. Schema changes are new entries in `MIGRATIONS`; shipped migrations are never edited.

### Upload pipeline

1. Stream the multipart parts to `DATA_DIR/tmp` (size-limited, never buffered in memory).
2. `ffprobe` must find an audio stream and a duration within `MAX_TRACK_MINUTES`.
3. `ffmpeg` re-encodes to 192 kbps CBR MP3 with all metadata and non-audio streams dropped (`-map 0:a:0 -map_metadata -1`, `-protocol_whitelist file` so crafted playlists cannot make ffmpeg open network URLs).
4. Waveform: mono 8 kHz PCM → 160 RMS buckets normalised to 0–100, stored as JSON.
5. Optional cover: any image → 640×640 JPEG via ffmpeg (which also proves it is an image).
6. One transaction inserts the track and its search row. On any failure the files are removed.

### Why MP3

Every browser plays it, including ones without AAC or Opus support, and with a constant bitrate plus the Xing/Info header `<audio>` seeks accurately over HTTP Range requests. The cost is size versus newer codecs.

## Client (`web/`)

Plain ES modules served as-is; an import map points `preact`, `preact/hooks` and `htm` at the copies in `node_modules` (served under `/vendor`). There is no bundler, so what you read is what runs.

- `app/main.js`: shell (sidebar, top bar, tab bar, routes). `router.js`: History API router.
- `player.js`: one `Audio` element, queue, shuffle order, repeat, Media Session, play counting. State lives in two tiny stores (`playerStore`, and `timeStore` which updates several times a second).
- `session.js`: current user/config, dialogs, per-track overrides (likes and deletions stay in sync everywhere).
- `components/`, `pages/`, `locales/` (English and Ukrainian, plural-aware), `css/app.css` (design tokens, light/dark).

Adding a language: create `web/app/locales/<code>.js` with the same keys as `en.js`, register it in `i18n.js`; `test/api/i18n.test.js` checks key parity and placeholders.

## Security model (summary, see SECURITY.md)

Cookie sessions with hashed tokens; scrypt passwords; CSRF by required custom header + Origin check; strict CSP (no inline scripts except the import map, allowed by hash); all SQL parameterised; FTS queries built from sanitised tokens; ids validated before touching the file system; user text normalised (control and bidi-override characters removed) and always rendered as text by Preact.
