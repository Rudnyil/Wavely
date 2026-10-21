# Running a public instance

See [LEGAL.md](LEGAL.md) for the full checklist, a takedown procedure, questions for a lawyer and a terms template.

This page is practical guidance, not legal advice. Laws differ by country; if you serve the public, ask a lawyer where you operate.

## What the software does for you

- Requires every uploader to state that the track is AI-generated and that they hold the rights, and to describe how it was made (the prompt is shown to listeners).
- Shows a license per track (commercial / non-commercial) so listeners know what they may do.
- Lets anyone report a track, with optional contact details for rights holders; gives moderators a queue and one-click removal.
- Optional pre-approval of uploads (`REQUIRE_APPROVAL=true`), invite-only or closed registration.
- Collects very little personal data (username, password hash, content) and lets users export or delete everything.

## What it cannot do

- Detect whether audio is AI-generated, whether a voice imitates a real person, or whether material infringes copyright. That needs people.
- Check the terms of the generator someone used. Several services restrict free-tier output to non-commercial use or forbid redistribution; the license field exists so uploaders state this, but it is a declaration.

## Suggested practice

1. **Publish contact details** for reports (the About page text can be customised in `web/app/locales/*.js`) and **respond promptly**. In many jurisdictions (for example under the US DMCA or the EU Digital Services Act) hosting providers keep liability protections only if they act on notices; check what registration or agent designation applies to you.
2. **Start with `REQUIRE_APPROVAL=true`** or invite-only registration, and loosen once you trust the community.
3. **Remove, don't ignore**: use "Remove track" on a report. Removed tracks are hidden everywhere but their files are kept so you can review or restore them; delete them permanently from the track page when appropriate.
4. **Back up** `DATA_DIR` ([DEPLOY.md](DEPLOY.md)) and keep your server patched.
5. **Privacy**: the app sets one session cookie and loads nothing from third parties. If you add analytics or other tooling, update your privacy notice.
6. **Voice and likeness**: tracks imitating a real person's voice are a reportable category; decide your policy and enforce it consistently.

## Limits that protect your server

`MAX_UPLOAD_MB`, `MAX_TRACK_MINUTES`, per-IP rate limits, `TRANSCODE_CONCURRENCY`. Reduce them on small machines.
