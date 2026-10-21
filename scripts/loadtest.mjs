/* Load test: seeds a temporary database with 20,000 tracks and 500 users, starts the server and measures list endpoints.
 * Usage: node scripts/loadtest.mjs   (takes about 1-2 minutes; touches no real data) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { openDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { ftsUpsert } from '../server/search.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-load-'));
const db = openDb(path.join(dir, 'wavely.db'));
const hash = await hashPassword('load test password');
const N_USERS = 500; const N_TRACKS = 20000;
const words = ['neon','rain','dream','synth','ocean','midnight','forest','echo','pulse','velvet','solar','drift','lofi','storm','crystal'];
const genres = ['Synthwave','Lo-fi','Ambient','Rock','Jazz','Pop','Techno','Folk'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const t0 = Date.now();
db.transaction(() => {
  for (let u = 1; u <= N_USERS; u += 1) db.prepare("INSERT INTO users (username, display_name, password_hash, role, created_at) VALUES (?,?,?,'user',?)").run(`user${u}`, `User ${u}`, hash, t0);
  const ins = db.prepare(`INSERT INTO tracks (id,user_id,title,genre,model,prompt,lyrics,license,duration,audio_bytes,peaks,status,plays,likes_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?)`);
  for (let i = 0; i < N_TRACKS; i += 1) {
    const id = `trk${String(i).padStart(8, '0')}`;
    const uid = 1 + (i % N_USERS);
    const title = `${pick(words)} ${pick(words)} ${i}`;
    const row = { id, title, genre: pick(genres), prompt: `${pick(words)} ${pick(words)} ${pick(words)} track`, lyrics: '' };
    ins.run(id, uid, title, row.genre, 'x', row.prompt, '', 'commercial', 180, 4e6, '[]', Math.floor(Math.random() * 1000), Math.floor(Math.random() * 100), t0 - i * 1000, t0 - i * 1000);
    ftsUpsert(db, row, `User ${uid} user${uid}`);
  }
})();
console.log('seed ms', Date.now() - t0, 'db MB', (fs.statSync(path.join(dir, 'wavely.db')).size / 1e6).toFixed(1));
db.close();

const port = await new Promise((resolve) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const { port: p } = srv.address(); srv.close(() => resolve(p)); }); });
const child = spawn('node', ['server/index.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, LOG_LEVEL: 'error', RATE_LIMIT: 'false' }, stdio: 'inherit' });
const base = `http://127.0.0.1:${port}`;
for (const sig of ['exit', 'SIGINT', 'SIGTERM']) process.on(sig, () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } });
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

async function bench(name, makeUrl, conc, total) {
  const lat = []; let errors = 0; let next = 0;
  const t = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < total) {
      const i = next++; const s = performance.now();
      try { const r = await fetch(base + makeUrl(i), { headers: { 'x-requested-with': 'wavely' } }); await r.arrayBuffer(); if (!r.ok) errors += 1; } catch { errors += 1; }
      lat.push(performance.now() - s);
    }
  }));
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.floor(lat.length * q)].toFixed(0);
  console.log(`${name.padEnd(28)} ${total} req @${conc}  ${(total / ((Date.now() - t) / 1000)).toFixed(0)} req/s  p50 ${p(0.5)}ms p95 ${p(0.95)}ms p99 ${p(0.99)}ms  errors ${errors}`);
}
await bench('home new (12)', () => '/api/tracks?sort=new&limit=12', 50, 2000);
await bench('popular page offset', (i) => `/api/tracks?sort=popular&limit=30&offset=${(i % 600) * 30}`, 50, 2000);
await bench('search 1 word', (i) => `/api/tracks?q=${pick(words)}`, 50, 1000);
await bench('search 2 words', () => `/api/tracks?q=${pick(words)}+${pick(words)}`, 50, 1000);
await bench('genre filter', () => `/api/tracks?genre=${pick(genres)}&limit=30`, 50, 1000);
await bench('genres list', () => '/api/genres', 50, 1000);
await bench('artists list', () => '/api/artists?limit=50', 50, 500);
await bench('track detail', (i) => `/api/tracks/trk${String(i % 20000).padStart(8, '0')}`, 50, 2000);
await bench('generated cover svg', (i) => `/api/tracks/trk${String(i % 20000).padStart(8, '0')}/cover`, 50, 2000);
await bench('static index', () => '/', 50, 2000);
// writes while reading
const cookie = (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'wavely' }, body: JSON.stringify({ username: 'user1', password: 'load test password' }) })).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
console.log('login ok', !!cookie);
const t1 = performance.now();
for (let i = 0; i < 200; i += 1) await fetch(`${base}/api/tracks/trk${String(i).padStart(8, '0')}/like`, { method: 'PUT', headers: { cookie, 'x-requested-with': 'wavely' } });
console.log('200 sequential likes ms', (performance.now() - t1).toFixed(0));
console.log('rss MB', (fs.readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1] / 1024).toFixed(0));
child.kill('SIGTERM');
await new Promise((r) => child.on('exit', r));
fs.rmSync(dir, { recursive: true, force: true });
