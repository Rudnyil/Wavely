import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { audio } from '../helpers.js';

const PASS = 'correct horse battery';

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function boot(dataDir, env = {}) {
  const port = await freePort();
  const child = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, LOG_LEVEL: 'warn', RATE_LIMIT: 'false', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(`${url}/healthz`)).ok) break; } catch { /* starting */ }
    if (child.exitCode !== null) throw new Error(`exited: ${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url, child, log: () => log,
    stop: () => new Promise((resolve) => { child.on('exit', (code, signal) => resolve({ code, signal })); child.kill('SIGTERM'); }),
  };
}

const headers = (cookie) => ({ 'x-requested-with': 'wavely', ...(cookie ? { cookie } : {}) });
const jsonHeaders = (cookie) => ({ ...headers(cookie), 'content-type': 'application/json' });
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

async function register(url, username) {
  const r = await fetch(`${url}/api/auth/register`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ username, password: PASS }) });
  return cookieOf(r);
}
function trackForm(buffer, title = 'Real HTTP') {
  const form = new FormData();
  Object.entries({ title, prompt: 'prompt text', confirmAi: 'true', license: 'commercial' }).forEach(([k, v]) => form.append(k, v));
  form.append('audio', new Blob([buffer], { type: 'audio/mpeg' }), 'a.mp3');
  return form;
}

describe('operations over a real socket', () => {
  test('data survives a restart; shutdown on SIGTERM is clean', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    let s = await boot(dir);
    try {
      const cookie = await register(s.url, 'alice');
      const up = await fetch(`${s.url}/api/tracks`, { method: 'POST', headers: headers(cookie), body: trackForm(audio.mp3()) });
      assert.equal(up.status, 201);
      const track = await up.json();
      const exit = await s.stop();
      assert.equal(exit.code, 0, `clean exit, got ${JSON.stringify(exit)}\n${s.log()}`);

      s = await boot(dir);
      const me = await (await fetch(`${s.url}/api/me`, { headers: headers(cookie) })).json();
      assert.equal(me.user.username, 'alice', 'session survives restart');
      const list = await (await fetch(`${s.url}/api/tracks`)).json();
      assert.equal(list.total, 1);
      const audioRes = await fetch(`${s.url}${track.audioUrl}`);
      assert.equal(audioRes.status, 200);
      assert.ok((await audioRes.arrayBuffer()).byteLength > 10000);
      const search = await (await fetch(`${s.url}/api/tracks?q=real`)).json();
      assert.equal(search.total, 1, 'search index persisted');
    } finally { await s.stop().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('oversized upload is rejected with 413 and the server keeps working', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    const s = await boot(dir, { MAX_UPLOAD_MB: '1' });
    try {
      const cookie = await register(s.url, 'alice');
      const big = Buffer.alloc(3 * 1024 * 1024, 7);
      let status;
      try {
        const r = await fetch(`${s.url}/api/tracks`, { method: 'POST', headers: headers(cookie), body: trackForm(big) });
        status = r.status;
      } catch (e) { status = `connection error: ${e.cause?.code || e.message}`; }
      assert.ok(status === 413 || String(status).startsWith('connection error'), `got ${status}`);
      assert.equal((await fetch(`${s.url}/healthz`)).status, 200);
      assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), [], 'temporary files cleaned up');
      const ok = await fetch(`${s.url}/api/tracks`, { method: 'POST', headers: headers(cookie), body: trackForm(audio.mp3()) });
      assert.equal(ok.status, 201);
    } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('an upload aborted halfway leaves no files and no database rows', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    const s = await boot(dir);
    try {
      const cookie = await register(s.url, 'alice');
      const port = Number(new URL(s.url).port);
      const boundary = '----abort';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`);
      await new Promise((resolve) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(`POST /api/tracks HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Requested-With: wavely\r\nCookie: ${cookie}\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 5000000\r\n\r\n`);
          sock.write(head);
          sock.write(audio.mp3().subarray(0, 20000));
          setTimeout(() => { sock.destroy(); resolve(); }, 300);
        });
        sock.on('error', () => {});
      });
      await new Promise((r) => setTimeout(r, 500));
      assert.equal((await fetch(`${s.url}/healthz`)).status, 200);
      assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
      assert.deepEqual(fs.readdirSync(path.join(dir, 'audio')), []);
      assert.equal((await (await fetch(`${s.url}/api/tracks`)).json()).total, 0);
    } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Range requests work over a real connection (what <audio> seeking uses)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    const s = await boot(dir);
    try {
      const cookie = await register(s.url, 'alice');
      const track = await (await fetch(`${s.url}/api/tracks`, { method: 'POST', headers: headers(cookie), body: trackForm(audio.medium()) })).json();
      const full = Buffer.from(await (await fetch(`${s.url}${track.audioUrl}`)).arrayBuffer());
      const r = await fetch(`${s.url}${track.audioUrl}`, { headers: { Range: 'bytes=1000-1999' } });
      assert.equal(r.status, 206);
      assert.equal(r.headers.get('content-range'), `bytes 1000-1999/${full.length}`);
      assert.deepEqual(Buffer.from(await r.arrayBuffer()), full.subarray(1000, 2000));
      const dur = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', path.join(dir, 'audio', `${track.id}.mp3`)]).toString()).format.duration;
      assert.ok(Math.abs(Number(dur) - 20) < 0.2, `stored duration ${dur}`);
    } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('create-admin CLI creates and resets an administrator', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    try {
      const run = (args, env = {}) => execFileSync('node', ['server/cli.js', 'create-admin', ...args], { env: { ...process.env, DATA_DIR: dir, ...env } }).toString();
      assert.match(run(['boss'], { WAVELY_PASSWORD: 'first password 1' }), /created/);
      assert.match(run(['boss'], { WAVELY_PASSWORD: 'second password 2' }), /administrator and the password was updated/);
      assert.throws(() => run(['x'], { WAVELY_PASSWORD: 'short' }), /Command failed/);
      const s = await boot(dir);
      try {
        const old = await fetch(`${s.url}/api/auth/login`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ username: 'boss', password: 'first password 1' }) });
        assert.equal(old.status, 401);
        const fresh = await fetch(`${s.url}/api/auth/login`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ username: 'boss', password: 'second password 2' }) });
        assert.equal(fresh.status, 200);
        assert.equal((await fresh.json()).user.role, 'admin');
      } finally { await s.stop(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('reset-password CLI changes the password of a regular user, keeps the role, ends sessions', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    const s = await boot(dir);
    try {
      await register(s.url, 'admin1'); // first account becomes admin
      const cookie = await register(s.url, 'bob');
      assert.equal((await fetch(`${s.url}/api/me`, { headers: headers(cookie) }).then((r) => r.json())).user.username, 'bob');
      const run = (args, env = {}) => execFileSync('node', ['server/cli.js', 'reset-password', ...args], { env: { ...process.env, DATA_DIR: dir, ...env } }).toString();
      assert.match(run(['bob'], { WAVELY_PASSWORD: 'brand new password' }), /updated and all their sessions were ended/);
      assert.throws(() => run(['nobody'], { WAVELY_PASSWORD: 'brand new password' }), /Command failed/);
      assert.equal((await fetch(`${s.url}/api/me`, { headers: headers(cookie) }).then((r) => r.json())).user, null);
      const old = await fetch(`${s.url}/api/auth/login`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ username: 'bob', password: PASS }) });
      assert.equal(old.status, 401);
      const fresh = await fetch(`${s.url}/api/auth/login`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ username: 'bob', password: 'brand new password' }) });
      assert.equal(fresh.status, 200);
      assert.equal((await fresh.json()).user.role, 'user');
    } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('invalid configuration fails fast with a clear message', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    try {
      const r = await new Promise((resolve) => {
        const c = spawn('node', ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, REGISTRATION: 'sometimes' } });
        let err = '';
        c.stderr.on('data', (d) => { err += d; });
        c.on('exit', (code) => resolve({ code, err }));
      });
      assert.equal(r.code, 1);
      assert.match(r.err, /REGISTRATION must be one of/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('server works when ffmpeg is missing: starts, health reports it, uploads fail cleanly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-ops-'));
    const s = await boot(dir, { FFMPEG_PATH: '/nonexistent/ffmpeg' });
    try {
      assert.equal((await (await fetch(`${s.url}/healthz`)).json()).ffmpeg, false);
      const cookie = await register(s.url, 'alice');
      const r = await fetch(`${s.url}/api/tracks`, { method: 'POST', headers: headers(cookie), body: trackForm(audio.mp3()) });
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error.code, 'ffmpeg_missing');
    } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
