# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately to the maintainers (use the repository's private vulnerability reporting, or the contact address published by the project you got Wavely from). Include steps to reproduce; we aim to acknowledge reports within a few days.

## Supported versions

The latest release receives security fixes.

## What is in place

| Area | Measure |
|---|---|
| Passwords | scrypt (N=32768, r=8, p=1), per-password random salt, constant-time comparison, dummy verification for unknown users |
| Sessions | 256-bit random token in an HttpOnly, SameSite=Lax cookie (`Secure` when `BASE_URL` is https); only the SHA-256 hash is stored; password change ends other sessions; disabling a user ends theirs |
| Brute force | Per-IP rate limits on registration, login, uploads, reports; per-username failure throttle (8 per 15 minutes) |
| CSRF | State-changing requests need the custom header `X-Requested-With: wavely`; `Origin` must match `Host`; no CORS |
| XSS | Strict Content-Security-Policy (`default-src 'none'`, scripts only from the site plus the import map by hash, no `unsafe-inline` for scripts, framing denied); the UI renders user text as text; user text is NFC-normalised and stripped of control/bidi-override characters; API responses are served with `nosniff` and a sandboxing CSP |
| Injection | All SQL parameterised; full-text queries are rebuilt from letter/digit tokens, so operators cannot be injected |
| Files | Track ids are validated before any path is built; uploads are streamed to a private temp directory with size limits; ffprobe/ffmpeg run without a shell, with `-protocol_whitelist file`; output is re-encoded (nothing from the original container survives); cover images are re-encoded to JPEG |
| Privacy | No email addresses; IP addresses are not stored (anonymous play de-duplication keeps only a truncated hash of IP and user agent, deleted after about 30 minutes); no third-party requests |
| Process | Docker image runs as non-root, read-only root filesystem and dropped capabilities in the provided Compose file |

## Known limits

- Rate limiting and login throttling are in memory and per process; they reset on restart.
- Moderation depends on people. See [docs/OPERATORS.md](docs/OPERATORS.md).
- Keep Node.js, ffmpeg and your dependencies up to date: media parsers are a common attack surface.
