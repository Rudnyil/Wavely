# HTTP API

The web client uses only this API, so everything it does you can script. Base path: `/api`. All bodies are JSON unless noted; times are Unix milliseconds.

## Conventions

- **Authentication**: a session cookie `wavely_session` (HttpOnly, SameSite=Lax) set by `register` and `login`.
- **CSRF protection**: every request other than `GET`/`HEAD` must send the header `X-Requested-With: wavely`. Requests with an `Origin` header that does not match `Host` are rejected. There is no CORS: the API is for same-origin use (or for scripts that send the cookie themselves).
- **Errors**: `{ "error": { "code": "machine_readable", "message": "Human readable" } }` with a suitable HTTP status (400 validation, 401 not signed in, 403 forbidden / CSRF, 404, 409 conflict, 413 too large, 429 rate limited, 503 ffmpeg missing).
- **Rate limits** (per IP, when `RATE_LIMIT=true`): register 10/hour, login 30/15 min (plus 8 failures per username per 15 min), upload 30/hour, report 10/hour, play 120/hour, general 1200/min.
- **Roles**: `user`, `moderator`, `admin`. "Mod" below means moderator or admin.

## Server

| Method & path | Auth | Description |
|---|---|---|
| `GET /healthz` (also `/api/health`) | – | `{status, version, ffmpeg}` for monitoring and container health checks |
| `GET /api/config` | – | Public settings: `name, version, registration, uploadPolicy, requireApproval, maxUploadMb, maxTrackMinutes, needsSetup, canUpload` |

## Accounts

| Method & path | Auth | Description |
|---|---|---|
| `POST /api/auth/register` | – | `{username, password, displayName?, inviteCode?}` → `201 {user}` + cookie. Username `[A-Za-z0-9_]{3,24}`, password 8–200 chars. First account on an empty server becomes `admin` |
| `POST /api/auth/login` | – | `{username, password}` → `{user}` + cookie |
| `POST /api/auth/logout` | – | Ends the session |
| `GET /api/me` | – | `{user}` or `{user: null}` |
| `PATCH /api/me` | user | `{displayName?, bio?}` |
| `POST /api/me/password` | user | `{current, next}`; signs out other devices |
| `GET /api/me/export` | user | Download of everything stored about the account |
| `POST /api/me/delete` | user | `{password}`; deletes the account, tracks, playlists, likes. Refused for the last admin |

User object: `{id, username, displayName, role, bio, createdAt}`.

## Tracks

Track object: `{id, title, genre, model, prompt, license, duration, plays, likes, liked, status, createdAt, hasCover, coverUrl, audioUrl, artist:{username, displayName}, userId}`. Detail responses add `lyrics` and `peaks` (160 integers 0–100). `status` is `published`, `pending` (awaiting approval) or `removed`; only published tracks are public.

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/tracks` | – | Query: `q` (full text), `sort` = `new` \| `popular` \| `liked` \| `title`, `genre`, `artist` (username), `liked=1` (own likes; needs sign-in), `limit` (≤100, default 30), `offset`. → `{items, total}` |
| `GET /api/tracks/mine` | user | Own tracks that are not removed |
| `GET /api/tracks/:id` | – | Detail. Pending tracks are visible to the owner and mods, removed ones to mods |
| `POST /api/tracks` | user | `multipart/form-data`: `audio` (file), `cover` (optional image), `title`, `prompt`, `confirmAi=true`, optional `genre`, `model`, `lyrics`, `license` (`commercial` \| `non_commercial`, default `non_commercial`). → `201` track. Fails with `invalid_audio`, `no_audio`, `too_long`, `too_large` (413), `invalid_cover`, `confirmation_required`, … |
| `PATCH /api/tracks/:id` | owner or mod | Any of `title, genre, model, prompt, lyrics, license` |
| `DELETE /api/tracks/:id` | owner or mod | Permanent delete (files, likes, playlist entries) |
| `PUT /api/tracks/:id/cover` | owner or mod | `multipart/form-data` with `cover` |
| `DELETE /api/tracks/:id/cover` | owner or mod | Back to the generated cover |
| `GET /api/tracks/:id/stream` | – | `audio/mpeg` with `Range` (206/416), `ETag` and 304 support |
| `GET /api/tracks/:id/cover` | – | `image/jpeg`, or a generated `image/svg+xml` |
| `POST /api/tracks/:id/play` | – | Counts a play (once per listener per 30 minutes). The web client calls it after 30 s of listening. → `{plays, counted}` |
| `PUT /api/tracks/:id/like`, `DELETE …/like` | user | Idempotent. → `{likes}` |
| `POST /api/tracks/:id/report` | – | `{reason, details?, contact?}`; `reason` ∈ `copyright, voice_imitation, not_ai, abuse, other` |
| `GET /api/genres` | – | `{items:[{name, tracks}]}` |
| `GET /api/artists` | – | Query `q`, `limit` → `{items:[{username, displayName, tracks, plays}]}` |
| `GET /api/artists/:username` | – | Profile with `bio`, `tracks`, `plays` |

## Playlists

Playlist object: `{id, name, description, isPublic, owner:{username, displayName}, tracks, updatedAt}`; detail responses add `items` (track objects, published only, in order).

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/playlists` | user | Own playlists |
| `GET /api/users/:username/playlists` | – | Public playlists of a user |
| `POST /api/playlists` | user | `{name, description?, isPublic?}` (max 100 playlists) |
| `GET /api/playlists/:id` | – | Public ones, the owner's own, and any for mods |
| `PATCH /api/playlists/:id` | owner | `{name?, description?, isPublic?}` |
| `DELETE /api/playlists/:id` | owner | |
| `POST /api/playlists/:id/tracks` | owner | `{trackId}` (max 1000 tracks; duplicates ignored) |
| `DELETE /api/playlists/:id/tracks/:trackId` | owner | |
| `PUT /api/playlists/:id/order` | owner | `{trackIds}` — must list every track exactly once |

## Moderation (mod) and administration (admin)

| Method & path | Auth | Description |
|---|---|---|
| `GET /api/admin/stats` | mod | Counters and audio storage size |
| `GET /api/admin/reports?status=open\|resolved` | mod | Reports with track and reporter info |
| `POST /api/admin/reports/:id/resolve` | mod | `{resolution: "dismissed" \| "removed"}`. Resolves every open report for that track; `removed` hides the track (files are kept until deleted) |
| `GET /api/admin/tracks?status=pending\|removed` | mod | Review queue / removed tracks |
| `POST /api/admin/tracks/:id/status` | mod | `{status: "published" \| "removed"}` (approve, reject, restore) |
| `GET /api/admin/users?q=` | admin | Users |
| `PATCH /api/admin/users/:id` | admin | `{role?, disabled?}`. You cannot demote or disable yourself. Disabling ends all sessions |

## Example

```bash
BASE=http://localhost:3000
curl -c jar -H 'X-Requested-With: wavely' -H 'Content-Type: application/json' \
  -d '{"username":"me","password":"a long password"}' $BASE/api/auth/register

curl -b jar -H 'X-Requested-With: wavely' \
  -F title='Neon Rain' -F prompt='dreamy synthwave' -F confirmAi=true -F license=commercial \
  -F audio=@song.mp3 $BASE/api/tracks
```
