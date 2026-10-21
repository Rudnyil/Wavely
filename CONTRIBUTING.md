# Contributing

Thanks for helping! A short guide:

1. **Open an issue first** for anything bigger than a small fix, so we can agree on the approach.
2. **Set up**: Node ≥ 22, ffmpeg, then `npm ci` and `npx playwright install chromium`.
3. **Run the tests** before and after your change: `npm test` (API) and `npm run test:e2e` (browser, accessibility, operations; set `WAVELY_BROWSER=firefox` or `webkit` to use another engine, CI runs all three). New behaviour needs a test; a bug fix needs a test that failed before the fix.
4. **Keep the client build-free**: plain ES modules, Preact + htm. Don't add a bundler or a runtime dependency without discussing it. Dependencies are kept small on purpose.
5. **Translations**: every user-visible string goes through `t()`/`tn()` with keys in `web/app/locales/en.js` and `uk.js`. `test/api/i18n.test.js` checks parity.
6. **Database changes** are new entries appended to `MIGRATIONS` in `server/db.js`; never edit a shipped one.
7. **Accessibility is a requirement**: the e2e suite runs axe-core on all pages in light and dark themes at desktop and phone sizes. Keep it green.
8. **Security-sensitive changes** (auth, uploads, file paths, headers) get extra review; see [SECURITY.md](SECURITY.md).

Commit messages: short imperative summary, details in the body if needed. Be kind in reviews and discussions.
