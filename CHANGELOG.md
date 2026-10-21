# Changelog

## Unreleased

- `npm run reset-password` for users who forgot their password (role unchanged, sessions ended).
- Security: uploads are limited to audio containers; covers over 40 megapixels are rejected before decoding (a 750 KB PNG could previously use 800 MB of memory).
- Performance: indexes for every sort order, no unneeded join when counting, search returns its total in one pass, search index updates no longer scan the whole index, artist list cached until the next write. On 20,000 tracks the home lists went from ~95 to ~850 requests/s and genre filters from ~125 to ~1,800 requests/s.
- Pages show an error with a retry button instead of crashing when a request fails; a dropped connection is retried once.
- `.npmrc` skips install scripts (better-sqlite3 ships prebuilt binaries).

## 0.1.0

First release.

- Streaming player with queue, shuffle, repeat, waveform seeking, Media Session, keyboard shortcuts.
- Accounts (cookie sessions, scrypt), roles (user, moderator, admin), invite-only or closed registration, upload policy, optional pre-approval.
- Upload pipeline with ffprobe validation, MP3 transcoding, waveform peaks, 640×640 covers.
- Likes, playlists, artist pages, genres, full-text search.
- Reports, moderation queue, removed-track review, user management, statistics.
- English and Ukrainian UI, light and dark themes, WCAG 2.2 AA checked.
- Docker image, Compose file, CI workflow, `create-admin` CLI, demo seed script.
