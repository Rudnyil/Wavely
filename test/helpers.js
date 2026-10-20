import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { buildApp } from '../server/app.js';

export async function makeApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-test-'));
  const config = loadConfig({ DATA_DIR: dir, RATE_LIMIT: 'false', ...env });
  const db = openDb(path.join(dir, 'wavely.db'));
  const app = await buildApp({ config, db, logger: false });
  await app.ready();
  return {
    app, db, config, dir,
    async close() {
      await app.close();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Sends a JSON request through fastify.inject with the headers the browser client sends. */
export async function call(app, method, url, { body, cookie, headers = {}, payload } = {}) {
  const res = await app.inject({
    method, url,
    headers: {
      'x-requested-with': 'wavely',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    payload: payload ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try { json = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, json, headers: res.headers, raw: res.rawPayload, res };
}

export function sessionCookie(res) {
  const sc = res.headers['set-cookie'];
  const line = Array.isArray(sc) ? sc.find((c) => c.startsWith('wavely_session=')) : sc;
  return line ? line.split(';')[0] : null;
}

let counter = 0;
export async function register(app, username = `user${++counter}`, extra = {}) {
  const r = await call(app, 'POST', '/api/auth/register', { body: { username, password: 'correct horse battery', ...extra } });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.json)}`);
  return { cookie: sessionCookie(r), user: r.json.user, username };
}

/** Builds a multipart/form-data body. files: { name: {filename, type, data:Buffer} } */
export function multipart(fields = {}, files = {}) {
  const boundary = `----wavely${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const [k, f] of Object.entries(files)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${f.filename}"\r\nContent-Type: ${f.type || 'application/octet-stream'}\r\n\r\n`));
    chunks.push(f.data, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const FIXTURES = path.join(os.tmpdir(), `wavely-fixtures-${process.pid}`);

/** Generates a small audio/video/image file with ffmpeg and returns its bytes. Cached per process. */
export function fixture(name, args, ext) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const file = path.join(FIXTURES, `${name}.${ext}`);
  if (!fs.existsSync(file)) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, file]);
  return fs.readFileSync(file);
}

const sine = (freq, secs) => ['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${secs}`];

export const audio = {
  mp3: () => fixture('tone-mp3', [...sine(440, 3), '-c:a', 'libmp3lame'], 'mp3'),
  wav: () => fixture('tone-wav', sine(523, 2), 'wav'),
  flac: () => fixture('tone-flac', sine(659, 2), 'flac'),
  ogg: () => fixture('tone-ogg', [...sine(330, 2), '-c:a', 'libvorbis'], 'ogg'),
  opus: () => fixture('tone-opus', [...sine(392, 2), '-c:a', 'libopus'], 'opus'),
  m4a: () => fixture('tone-m4a', [...sine(494, 2), '-c:a', 'aac'], 'm4a'),
  medium: () => fixture('tone-medium', sine(262, 20), 'mp3'),
  long: () => fixture('tone-long', sine(300, 130), 'mp3'),
  videoOnly: () => fixture('video-only', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'], 'mp4'),
  withVideo: () => fixture('video-with-audio', ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=5', ...sine(440, 2), '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'], 'mp4'),
};

export const image = {
  png: () => fixture('cover-png', ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=300x200:rate=1', '-frames:v', '1'], 'png'),
};

export function uploadForm(extra = {}, fileData = audio.mp3(), files = {}) {
  return multipart(
    { title: 'Test track', prompt: 'A calm synthwave piece', genre: 'Synthwave', model: 'Suno v4', license: 'commercial', confirmAi: 'true', ...extra },
    { audio: { filename: 'a.mp3', type: 'audio/mpeg', data: fileData }, ...files },
  );
}

export async function upload(app, cookie, extra = {}, fileData, files) {
  const form = uploadForm(extra, fileData, files);
  return call(app, 'POST', '/api/tracks', { cookie, payload: form.payload, headers: form.headers });
}
