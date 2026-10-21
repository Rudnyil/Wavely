import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import * as playwright from 'playwright';

// WAVELY_BROWSER=chromium (default) | firefox | webkit
const ENGINE = process.env.WAVELY_BROWSER || 'chromium';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

/** Starts a real Wavely server process on a free port with a fresh data directory. */
export async function startServer(env = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-e2e-'));
  const child = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn', RATE_LIMIT: 'false', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch(`${url}/healthz`); if (r.ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`server exited: ${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url, dataDir, port,
    logs: () => log,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((r) => { child.on('exit', r); setTimeout(r, 5000); });
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const openContexts = new Set();
/** Closes every context opened by openPage; call from afterEach so a failed assertion cannot leave a page running. */
export async function closeOpenContexts() {
  for (const c of [...openContexts]) await c.close().catch(() => {});
  openContexts.clear();
}

export async function launch() {
  const launcher = playwright[ENGINE];
  if (!launcher) throw new Error(`Unknown WAVELY_BROWSER "${ENGINE}"`);
  if (ENGINE === 'chromium') return launcher.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  if (ENGINE === 'firefox') return launcher.launch({ firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } });
  return launcher.launch();
}

/** Opens a page and records console errors, page errors and failed requests so tests can assert there are none. */
export async function openPage(browser, url, { viewport = { width: 1280, height: 800 }, colorScheme = 'dark', locale = 'en-US', hasTouch = false } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, locale, hasTouch, acceptDownloads: true });
  openContexts.add(context);
  context.on('close', () => openContexts.delete(context));
  const page = await context.newPage();
  const problems = [];
  // Engines log cancelled loads (the page navigated away) as errors: Firefox NS_BINDING_ABORTED for fonts, WebKit access-control failures for fetches.
  const abortNoise = (text) => /status=2152398850|NS_BINDING_ABORTED|Load request cancelled|due to access control checks/.test(text);
  page.on('console', (m) => { if (m.type() === 'error' && !abortNoise(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => abortNoise(e.message) || problems.push(`pageerror: ${e.message} @ ${String(e.stack || '').split('\n').slice(0, 3).join(' | ')}`));
  // A request cancelled because the page navigated away is normal; engines word it differently.
  const pending = new Set();
  page.on('request', (r) => pending.add(r.url()));
  page.on('requestfinished', (r) => pending.delete(r.url()));
  page.on('requestfailed', (r) => {
    pending.delete(r.url());
    const e = r.failure()?.errorText || '';
    if (!/ABORTED|cancel/i.test(e)) problems.push(`requestfailed: ${r.url()} ${e}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  try {
    // Firefox under CI sometimes never reports the navigation as finished to Playwright although the page is complete.
    const navigate = () => page.goto(url, { waitUntil: ENGINE === 'firefox' ? 'domcontentloaded' : 'load', timeout: ENGINE === 'firefox' ? 12000 : 30000 });
    // A navigation that hangs in Firefox is retried once; it is not an application problem (the server answers immediately).
    try { await navigate(); } catch (first) { if (ENGINE !== 'firefox') throw first; await navigate(); }
  } catch (err) {
    const state = await Promise.race([
      page.evaluate(() => ({ ready: document.readyState, fonts: document.fonts.status, resources: performance.getEntriesByType('resource').length, url: location.href })),
      new Promise((r) => setTimeout(() => r('page unresponsive'), 3000)),
    ]).catch((e) => `evaluate failed: ${e.message}`);
    if (ENGINE === 'firefox' && state?.ready === 'complete') return { page, context, problems };
    err.message += `\nrequests still pending: ${[...pending].join(', ') || 'none'}; page state: ${JSON.stringify(state)}`;
    throw err;
  }
  return { page, context, problems };
}
