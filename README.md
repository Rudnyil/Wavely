# Wavely

**Open-source, self-hosted music streaming for AI-generated music.**
Think Spotify, but every track is made with AI (Suno, Udio, MusicGen, …) and shows the prompt behind it.

[Українська версія](README.uk.md) · [API](docs/API.md) · [Deployment](docs/DEPLOY.md) · [Architecture](docs/ARCHITECTURE.md) · [Operators' guide](docs/OPERATORS.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Features

- **Listening**: persistent player with queue, shuffle, repeat, volume, waveform seeking, keyboard shortcuts and lock-screen controls (Media Session). Works on desktop and phones.
- **Library**: likes, public/private playlists with ordering, artist pages, genres, full-text search (prefix and diacritics-insensitive) over titles, artists, genres, prompts and lyrics.
- **Uploading**: MP3, WAV, FLAC, OGG, Opus, M4A and more. Everything is validated with ffprobe and transcoded to 192 kbps MP3 (plays in every browser, seeks accurately), metadata is stripped, a waveform is computed, covers are cropped to 640×640.
- **AI-only by design**: every track needs a prompt/description and an explicit "this is AI-generated and I have the rights" confirmation. Each track shows a license (commercial / non-commercial).
- **Moderation**: anyone can report a track (no account needed, rights holders can leave contact details). Moderators resolve reports, review a pre-approval queue, restore removed tracks and manage users.
- **Privacy**: no email, no tracking, no third-party requests (fonts and libraries are self-hosted). Users can export or delete all their data.
- **Self-hosting friendly**: one Node process, one SQLite file, one folder for audio. Docker image, health endpoint, graceful shutdown, no build step for the frontend.
- **Accessible and bilingual**: English and Ukrainian UI, light/dark themes, WCAG 2.2 AA checks (axe-core) in the test suite.

## Quick start

Requirements: Node.js ≥ 22 and `ffmpeg` (with `ffprobe` and the MP3 encoder, which standard builds include).

```bash
git clone <your-fork-or-repo-url> wavely && cd wavely
npm ci --omit=dev
npm start
# open http://localhost:3000 — the first account you create becomes the administrator
```

Try it with demo content: `npm run seed` (creates user `demo` and six generated tracks on a running server).

### Docker

```bash
docker compose up -d --build
# open http://localhost:3000
```

Data lives in the `wavely-data` volume (mounted at `/data`). See [docs/DEPLOY.md](docs/DEPLOY.md) for HTTPS, reverse proxies, backups and upgrades.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Where to listen |
| `BASE_URL` | empty | Public URL. `https://…` enables Secure cookies and HSTS |
| `DATA_DIR` | `./data` | Database, audio and covers |
| `INSTANCE_NAME` | `Wavely` | Name shown in the UI |
| `REGISTRATION` | `open` | `open`, `invite` (needs `INVITE_CODE`) or `closed` |
| `UPLOAD_POLICY` | `users` | `users` or `admins` |
| `REQUIRE_APPROVAL` | `false` | Regular users' uploads wait for a moderator |
| `MAX_UPLOAD_MB` | `100` | Largest accepted file |
| `MAX_TRACK_MINUTES` | `20` | Longest accepted track |
| `SESSION_DAYS` | `30` | Login lifetime |
| `TRUST_PROXY` | `false` | Honour `X-Forwarded-For` (only behind your own proxy) |
| `TRANSCODE_CONCURRENCY` | `2` | Parallel ffmpeg jobs |
| `RATE_LIMIT` | `true` | Per-IP rate limits |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | Binary locations |

Invalid values stop the server at startup with a clear message.

### Administration

- The first account on an empty server becomes the administrator. Create or reset one from the shell: `npm run create-admin -- <username>` with the password in `WAVELY_PASSWORD` (or as a second argument).
- Roles: `user`, `moderator` (reports, review queue, removed tracks), `admin` (everything, including user management).
- There is no email-based password reset by design (no email is collected): an administrator resets a password with the CLI above.

## Development and tests

```bash
npm ci
npm test            # API tests (node:test + Fastify inject): auth, permissions, uploads, streaming, search, moderation, security
npx playwright install chromium
npm run test:e2e    # real browser: full user flows, accessibility (axe-core), mobile layout, restarts, aborted uploads, CLI
npm run dev         # restart on file changes
```

The test suite generates its own audio and images with ffmpeg; nothing is downloaded.

## How it is built

Fastify 5 + SQLite (better-sqlite3, FTS5) + ffmpeg on the server; Preact + htm served as plain ES modules (no bundler) on the client. Details and the security model are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Limits to know about

- One server process with a local SQLite database and local file storage. That comfortably serves a community instance; it is not built for horizontal scaling.
- No federation between instances and no email features (notifications, password reset).
- Audio is transcoded to MP3 on upload. Original files are not kept.
- The software cannot decide whether a track is really AI-generated or whether you hold the rights. It asks for a declaration, shows the prompt, and gives moderators tools. Running a public instance carries legal responsibilities, see [docs/OPERATORS.md](docs/OPERATORS.md).

## License

[MIT](LICENSE). Fonts (Onest, Geologica, JetBrains Mono) are distributed under the SIL Open Font License through the `@fontsource` packages.
