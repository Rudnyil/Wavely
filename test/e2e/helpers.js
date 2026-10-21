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

export async function launch() {
  const launcher = playwright[ENGINE];
  if (!launcher) throw new Error(`Unknown WAVELY_BROWSER "${ENGINE}"`);
  return launcher.launch(ENGINE === 'chromium' ? { args: ['--autoplay-policy=no-user-gesture-required'] } : {});
}

/** Opens a page and records console errors, page errors and failed requests so tests can assert there are none. */
export async function openPage(browser, url, { viewport = { width: 1280, height: 800 }, colorScheme = 'dark', locale = 'en-US', hasTouch = false } = {}) {
  const context = await browser.newContext({ viewport, colorScheme, locale, hasTouch, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => { const e = r.failure()?.errorText; if (e !== 'net::ERR_ABORTED') problems.push(`requestfailed: ${r.url()} ${e}`); });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  await page.goto(url);
  return { page, context, problems };
}
