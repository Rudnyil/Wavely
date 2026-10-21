import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiError } from './errors.js';
import { COOKIE_NAME, LoginThrottle, csrfHook, lookupUser, purgeExpired } from './auth.js';
import { createMedia } from './media.js';
import { createStorage } from './storage.js';

import metaRoutes from './routes/meta.js';
import authRoutes from './routes/auth.js';
import trackRoutes from './routes/tracks.js';
import playlistRoutes from './routes/playlists.js';
import adminRoutes from './routes/admin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const NM = path.join(ROOT, 'node_modules');

const VENDOR = [
  ['/vendor/preact/', path.join(NM, 'preact')],
  ['/vendor/htm/', path.join(NM, 'htm')],
  ['/vendor/fonts/', path.join(NM, '@fontsource-variable')],
  ['/vendor/fonts-static/', path.join(NM, '@fontsource')],
];

function buildCsp(importMapHashes) {
  return [
    "default-src 'none'",
    `script-src 'self' ${importMapHashes.map((h) => `'sha256-${h}'`).join(' ')}`.trim(),
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export async function buildApp({ config, db, logger = false }) {
  const app = Fastify({
    logger: logger === false ? false : logger,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 200 },
  });

  const storage = createStorage(config.dataDir);
  const media = createMedia(config);
  const ffmpegOk = await media.available();
  if (!ffmpegOk) app.log.error('ffmpeg/ffprobe not found: uploads will fail. Set FFMPEG_PATH / FFPROBE_PATH.');

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('storage', storage);
  app.decorate('media', media);
  app.decorate('ffmpegOk', ffmpegOk);
  app.decorate('loginThrottle', new LoginThrottle());
  app.decorateRequest('user', null);
  // Bumped after every successful write request; read-heavy aggregates (artist list) are cached until it changes.
  app.decorate('dataVersion', 0);
  // onSend runs before the response leaves, so a client that reads right after its own write never sees the old cache.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400) app.dataVersion += 1;
    return payload;
  });

  await app.register(fastifyCookie);
  if (config.rateLimit) {
    await app.register(fastifyRateLimit, { global: true, max: 1200, timeWindow: '1 minute' });
  }

  // --- security & auth hooks -------------------------------------------------
  app.addHook('onRequest', async (req) => {
    csrfHook(req);
    if (req.url.startsWith('/api/')) {
      req.user = lookupUser(db, req.cookies?.[COOKIE_NAME]);
    }
  });

  let indexCache = { mtime: 0, html: '', csp: '' };
  function loadIndex() {
    const file = path.join(WEB, 'index.html');
    const mtime = fs.statSync(file).mtimeMs;
    if (mtime !== indexCache.mtime) {
      const html = fs.readFileSync(file, 'utf8');
      const hashes = [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)]
        .map((m) => crypto.createHash('sha256').update(m[1]).digest('base64'));
      indexCache = { mtime, html, csp: buildCsp(hashes) };
    }
    return indexCache;
  }

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000');
    const ct = String(reply.getHeader('content-type') || '');
    if (ct.startsWith('text/html')) reply.header('Content-Security-Policy', loadIndex().csp);
    else if (req.url.startsWith('/api/')) {
      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
      if (!reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    const lastSegment = url.split('/').pop();
    if (req.method === 'GET' && !lastSegment.includes('.') && !url.startsWith('/vendor/')) {
      return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(loadIndex().html);
    }
    return reply.code(404).type('text/plain').send('Not found');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const status = err.statusCode || err.status;
    if (status === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests, try again later' } });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'too_large', message: 'The file or request is too large' } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: 'Invalid request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } });
  });

  // --- API -------------------------------------------------------------------
  await app.register(metaRoutes);
  await app.register(authRoutes);
  await app.register(trackRoutes);
  await app.register(playlistRoutes);
  await app.register(adminRoutes);

  // --- static client ---------------------------------------------------------
  const cacheHeaders = (reply) => reply.header('Cache-Control', 'no-cache');
  await app.register(fastifyStatic, {
    root: WEB, prefix: '/', index: false, wildcard: false, cacheControl: false, setHeaders: cacheHeaders,
  });
  for (const [prefix, root] of VENDOR) {
    if (!fs.existsSync(root)) continue;
    await app.register(fastifyStatic, {
      root, prefix, index: false, decorateReply: false, dotfiles: 'deny', cacheControl: false,
      setHeaders: (reply) => reply.header('Cache-Control', 'public, max-age=86400'),
    });
  }

  app.get('/favicon.ico', async (req, reply) => reply.code(204).send());

  const timer = setInterval(() => { try { purgeExpired(db); } catch { /* ignore */ } }, 60 * 60 * 1000);
  timer.unref();
  purgeExpired(db);
  app.addHook('onClose', async () => { clearInterval(timer); });

  return app;
}
