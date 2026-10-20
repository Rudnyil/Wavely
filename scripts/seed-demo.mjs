#!/usr/bin/env node
// Fills a running Wavely server with a few generated demo tracks (synthesized tones + gradient covers).
// Usage: node scripts/seed-demo.mjs [BASE_URL] [USERNAME] [PASSWORD]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base = 'http://localhost:3000', username = 'demo', password = 'demo-password-123'] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-seed-'));
const H = { 'X-Requested-With': 'wavely' };

async function call(method, url, body, cookie) {
  const headers = { ...H, ...(cookie ? { cookie } : {}) };
  let payload = body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + url, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  return { res, json };
}

let { res, json } = await call('POST', '/api/auth/register', { username, password, displayName: 'Demo Artist' });
if (res.status === 409) ({ res, json } = await call('POST', '/api/auth/login', { username, password }));
if (!res.ok) { console.error('Cannot sign in:', json); process.exit(1); }
const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const TRACKS = [
  ['Neon Rain', 'Synthwave', 'Suno v4', 'Dreamy synthwave with arpeggiated bass, night drive, 110 bpm', 262, 28],
  ['Paper Moons', 'Lo-fi', 'Udio', 'Warm lo-fi hip hop beat with vinyl crackle and soft piano', 330, 24],
  ['Glass Garden', 'Ambient', 'MusicGen', 'Slow evolving ambient pads, glassy textures, no drums', 196, 32],
  ['Static Hearts', 'Indie Pop', 'Suno v4', 'Upbeat indie pop with jangly guitars and female vocals', 392, 22],
  ['Тиха вода', 'Folk', 'Suno v4', 'Ukrainian folk ballad, acoustic guitar, gentle vocals', 294, 26],
  ['Midnight Express', 'House', 'Udio', 'Deep house groove, rolling bassline, 122 bpm', 247, 30],
];
const COVERS = ['0x8b5cf6:0x22d3ee', '0xf59e0b:0xef4444', '0x10b981:0x3b82f6', '0xec4899:0x8b5cf6', '0x14b8a6:0xfbbf24', '0x6366f1:0x0ea5e9'];

for (const [i, [title, genre, model, prompt, freq, secs]] of TRACKS.entries()) {
  const mp3 = path.join(dir, `${i}.mp3`);
  const png = path.join(dir, `${i}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${secs}`, '-af', 'tremolo=f=3:d=0.4', mp3]);
  const [c0, c1] = COVERS[i].split(':');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=600x600:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=600:y1=600:d=1`, '-frames:v', '1', png]);
  const form = new FormData();
  Object.entries({ title, genre, model, prompt, license: i % 2 ? 'non_commercial' : 'commercial', confirmAi: 'true' }).forEach(([k, v]) => form.append(k, v));
  form.append('audio', new Blob([fs.readFileSync(mp3)], { type: 'audio/mpeg' }), `${title}.mp3`);
  form.append('cover', new Blob([fs.readFileSync(png)], { type: 'image/png' }), 'cover.png');
  const r = await call('POST', '/api/tracks', form, cookie);
  console.log(r.res.status === 201 ? `uploaded: ${title}` : `failed: ${title} ${JSON.stringify(r.json)}`);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Done. Sign in as "${username}" / "${password}".`);
