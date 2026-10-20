# Deployment

Wavely is one Node.js process plus `ffmpeg`. State is a single directory (`DATA_DIR`): `wavely.db` (SQLite, WAL mode), `audio/`, `covers/`.

## 1. Pick how to run it

**Docker Compose** (recommended)

```bash
cp .env.example .env     # set BASE_URL=https://music.example.com and the options you want
docker compose up -d --build
```

The image runs as a non-root user, has a health check (`/healthz`) and stores data in the `wavely-data` volume.

**Without Docker**

```bash
npm ci --omit=dev
DATA_DIR=/var/lib/wavely PORT=3000 BASE_URL=https://music.example.com TRUST_PROXY=true node server/index.js
```

Run it under systemd so it restarts on failure:

```ini
# /etc/systemd/system/wavely.service
[Unit]
Description=Wavely
After=network.target

[Service]
User=wavely
WorkingDirectory=/opt/wavely
EnvironmentFile=/etc/wavely.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/wavely
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## 2. Put HTTPS in front

Wavely speaks plain HTTP; terminate TLS in a reverse proxy and set `BASE_URL=https://…` and `TRUST_PROXY=true` (so rate limits see real client addresses and cookies are `Secure`).

**Caddy**

```
music.example.com {
    request_body {
        max_size 120MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

**nginx**

```nginx
server {
    listen 443 ssl http2;
    server_name music.example.com;
    # ssl_certificate / ssl_certificate_key …

    client_max_body_size 120m;          # slightly above MAX_UPLOAD_MB
    proxy_request_buffering off;        # stream uploads straight to the app

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;        # transcoding long tracks takes a while
    }
}
```

The proxy must pass `Host` unchanged: the CSRF check compares the `Origin` header with `Host`.

## 3. First start

1. Open the site and create the first account: it becomes the administrator. Or run `npm run create-admin -- <username>` (password in `WAVELY_PASSWORD`).
2. Decide who may join and upload: `REGISTRATION`, `INVITE_CODE`, `UPLOAD_POLICY`, `REQUIRE_APPROVAL`. For a public instance, `REQUIRE_APPROVAL=true` is a sensible start.
3. Read [OPERATORS.md](OPERATORS.md).

## 4. Backups

Stop the server, or use SQLite's online backup, then copy the directory:

```bash
# consistent copy while running (needs the sqlite3 CLI)
sqlite3 /var/lib/wavely/wavely.db ".backup '/backups/wavely-$(date +%F).db'"
rsync -a /var/lib/wavely/audio/ /backups/audio/
rsync -a /var/lib/wavely/covers/ /backups/covers/
```

Restore by putting the three items back into `DATA_DIR` while the server is stopped.

## 5. Upgrading

```bash
git pull
npm ci --omit=dev      # or: docker compose up -d --build
```

Database migrations run automatically at startup and are applied in order. The server refuses to start if the database was written by a newer version, so rolling back needs a backup from before the upgrade.

## 6. Operations notes

- Health: `GET /healthz` → `{"status":"ok","ffmpeg":true}`. `ffmpeg:false` means uploads will fail until `ffmpeg`/`ffprobe` are available.
- Logs are JSON on stdout (`LOG_LEVEL=info|warn|error|debug`).
- `SIGTERM`/`SIGINT` close the HTTP server and database cleanly; in-flight uploads are discarded and their temporary files removed at next start.
- Disk use is roughly 1.4 MB per minute of audio (192 kbps) plus ~50 KB per cover. `GET /api/admin/stats` shows the total.
- CPU: each upload runs ffmpeg for probing, transcoding and waveform extraction, limited by `TRANSCODE_CONCURRENCY`.
