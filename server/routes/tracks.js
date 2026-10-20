import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';

import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { isModerator, requireUser } from '../auth.js';
import { canView, getTrackRow, listOwnTracks, listTracks, serializeTrack } from '../repo.js';
import { ftsDelete, ftsUpsert } from '../search.js';
import { sendFile } from '../stream.js';
import { generatedCover } from '../cover.js';
import { clampInt, cleanText, newId, now, sha256 } from '../util.js';

const LICENSES = ['commercial', 'non_commercial'];
const REPORT_REASONS = ['copyright', 'voice_imitation', 'not_ai', 'abuse', 'other'];
const PLAY_DEDUPE_MS = 30 * 60 * 1000;

const limit = (max, timeWindow) => ({ config: { rateLimit: { max, timeWindow } } });

function readFields(src, { partial }) {
  const out = {};
  const take = (key, max, { required = false } = {}) => {
    if (src[key] === undefined) {
      if (required && !partial) throw badRequest(`missing_${key}`, `Field "${key}" is required`);
      return;
    }
    const v = cleanText(src[key], max);
    if (required && !v) throw badRequest(`missing_${key}`, `Field "${key}" cannot be empty`);
    out[key] = v;
  };
  take('title', 120, { required: true });
  take('genre', 40);
  take('model', 60);
  take('prompt', 2000, { required: true });
  take('lyrics', 10000);
  if (out.prompt !== undefined && out.prompt.length < 3) throw badRequest('missing_prompt', 'Describe how the track was generated');
  if (src.license !== undefined) {
    if (!LICENSES.includes(src.license)) throw badRequest('invalid_license', 'License must be commercial or non_commercial');
    out.license = src.license;
  } else if (!partial) out.license = 'non_commercial';
  return out;
}

export default async function trackRoutes(app) {
  const { db, config, storage, media } = app;

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 2, fields: 12, fieldSize: 20000, parts: 16 },
  });

  const artistString = (userId) => {
    const u = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
    return `${u.display_name} ${u.username}`;
  };

  function visibleRow(req, id) {
    if (!storage.isValidId(id)) throw notFound('Track not found');
    const row = getTrackRow(db, id, req.user);
    if (!canView(row, req.user)) throw notFound('Track not found');
    return row;
  }

  function editableRow(req, id) {
    const user = requireUser(req);
    const row = visibleRow(req, id);
    if (row.user_id !== user.id && !isModerator(user)) throw forbidden();
    return row;
  }

  /** Streams multipart parts to temp files; returns text fields and temp paths. */
  async function receive(req, tmpFiles, allowed) {
    if (!req.isMultipart()) throw badRequest('multipart_required', 'Send the request as multipart/form-data');
    const fields = {};
    const files = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!allowed.includes(part.fieldname) || !part.filename) { part.file.resume(); continue; }
        const tmp = storage.tmpPath(newId(12));
        tmpFiles.push(tmp);
        await pipeline(part.file, fs.createWriteStream(tmp));
        if (part.file.truncated) throw new ApiError(413, 'too_large', 'The file is too large');
        files[part.fieldname] = tmp;
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    return { fields, files };
  }

  async function processCover(tmp, id) {
    if (fs.statSync(tmp).size > config.maxCoverMb * 1024 * 1024) {
      throw new ApiError(413, 'cover_too_large', `The cover must be smaller than ${config.maxCoverMb} MB`);
    }
    const out = storage.tmpPath(newId(12));
    try {
      await media.cover(tmp, out);
      fs.renameSync(out, storage.coverPath(id));
    } finally {
      fs.rmSync(out, { force: true });
    }
  }

  // ---- listing ------------------------------------------------------------
  app.get('/api/tracks', async (req) => {
    const q = req.query;
    const opts = {
      q: typeof q.q === 'string' ? q.q.slice(0, 100) : '',
      sort: q.sort,
      genre: typeof q.genre === 'string' ? q.genre : '',
      artist: typeof q.artist === 'string' ? q.artist : '',
      limit: clampInt(q.limit, 30, 1, 100),
      offset: clampInt(q.offset, 0, 0, 1e6),
    };
    if (q.liked === '1') {
      const user = requireUser(req);
      opts.likedBy = user.id;
    }
    return listTracks(db, req.user, opts);
  });

  app.get('/api/tracks/mine', async (req) => ({ items: listOwnTracks(db, requireUser(req)) }));

  app.get('/api/tracks/:id', async (req) => serializeTrack(visibleRow(req, req.params.id), { detail: true }));

  // ---- upload -------------------------------------------------------------
  app.post('/api/tracks', limit(30, '1 hour'), async (req, reply) => {
    const user = requireUser(req);
    if (config.uploadPolicy === 'admins' && user.role !== 'admin') {
      throw forbidden('Uploads are restricted to administrators on this server');
    }
    if (!app.ffmpegOk) throw new ApiError(503, 'ffmpeg_missing', 'The server cannot process audio right now');
    const tmpFiles = [];
    const id = newId();
    try {
      const { fields, files } = await receive(req, tmpFiles, ['audio', 'cover']);
      if (!files.audio) throw badRequest('missing_audio', 'Attach an audio file');
      if (fields.confirmAi !== 'true') {
        throw badRequest('confirmation_required', 'Confirm that the track is AI-generated and you have the right to publish it');
      }
      const data = readFields(fields, { partial: false });
      const info = await media.probe(files.audio);
      if (info.duration > config.maxTrackMinutes * 60) {
        throw badRequest('too_long', `Tracks can be at most ${config.maxTrackMinutes} minutes long`);
      }
      const final = storage.audioPath(id);
      const work = storage.tmpPath(newId(12));
      tmpFiles.push(work);
      await media.transcode(files.audio, work, config.maxTrackMinutes * 60 + 5);
      fs.renameSync(work, final);
      const peaks = await media.peaks(final, info.duration);
      let hasCover = 0;
      if (files.cover) { await processCover(files.cover, id); hasCover = 1; }
      const status = config.requireApproval && user.role === 'user' ? 'pending' : 'published';
      const t = now();
      db.transaction(() => {
        db.prepare(
          `INSERT INTO tracks (id, user_id, title, genre, model, prompt, lyrics, license, duration, audio_bytes,
                               peaks, has_cover, status, created_at, updated_at)
           VALUES (@id,@user_id,@title,@genre,@model,@prompt,@lyrics,@license,@duration,@audio_bytes,
                   @peaks,@has_cover,@status,@t,@t)`,
        ).run({
          id, user_id: user.id, title: data.title, genre: data.genre ?? '', model: data.model ?? '',
          prompt: data.prompt, lyrics: data.lyrics ?? '', license: data.license,
          duration: info.duration, audio_bytes: fs.statSync(final).size, peaks: JSON.stringify(peaks),
          has_cover: hasCover, status, t,
        });
        ftsUpsert(db, { id, ...data, genre: data.genre ?? '', lyrics: data.lyrics ?? '' }, artistString(user.id));
      })();
      return reply.code(201).send(serializeTrack(getTrackRow(db, id, user), { detail: true }));
    } catch (e) {
      storage.remove(id);
      throw e;
    } finally {
      for (const f of tmpFiles) fs.rmSync(f, { force: true });
    }
  });

  // ---- edit / delete --------------------------------------------------------
  app.patch('/api/tracks/:id', async (req) => {
    const row = editableRow(req, req.params.id);
    const data = readFields(req.body || {}, { partial: true });
    const merged = { ...row, ...data };
    db.transaction(() => {
      db.prepare(
        `UPDATE tracks SET title=@title, genre=@genre, model=@model, prompt=@prompt, lyrics=@lyrics,
                license=@license, updated_at=@t WHERE id=@id`,
      ).run({ ...merged, t: now() });
      ftsUpsert(db, merged, artistString(row.user_id));
    })();
    return serializeTrack(getTrackRow(db, row.id, req.user), { detail: true });
  });

  app.delete('/api/tracks/:id', async (req) => {
    const row = editableRow(req, req.params.id);
    db.transaction(() => {
      ftsDelete(db, row.id);
      db.prepare('DELETE FROM tracks WHERE id = ?').run(row.id);
    })();
    storage.remove(row.id);
    return { ok: true };
  });

  app.put('/api/tracks/:id/cover', limit(30, '1 hour'), async (req) => {
    const row = editableRow(req, req.params.id);
    const tmpFiles = [];
    try {
      const { files } = await receive(req, tmpFiles, ['cover']);
      if (!files.cover) throw badRequest('missing_cover', 'Attach an image');
      await processCover(files.cover, row.id);
      db.prepare('UPDATE tracks SET has_cover = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
    } finally {
      for (const f of tmpFiles) fs.rmSync(f, { force: true });
    }
    return serializeTrack(getTrackRow(db, row.id, req.user), { detail: true });
  });

  app.delete('/api/tracks/:id/cover', async (req) => {
    const row = editableRow(req, req.params.id);
    storage.removeCover(row.id);
    db.prepare('UPDATE tracks SET has_cover = 0, updated_at = ? WHERE id = ?').run(now(), row.id);
    return serializeTrack(getTrackRow(db, row.id, req.user), { detail: true });
  });

  // ---- media ----------------------------------------------------------------
  app.get('/api/tracks/:id/stream', { config: { rateLimit: false } }, (req, reply) => {
    const row = visibleRow(req, req.params.id);
    return sendFile(req, reply, storage.audioPath(row.id), {
      type: 'audio/mpeg',
      cacheControl: row.status === 'published' ? 'public, max-age=3600' : 'private, no-store',
    });
  });

  app.get('/api/tracks/:id/cover', { config: { rateLimit: false } }, (req, reply) => {
    const row = visibleRow(req, req.params.id);
    const cacheControl = row.status === 'published' ? 'public, max-age=86400' : 'private, no-store';
    if (row.has_cover && fs.existsSync(storage.coverPath(row.id))) {
      return sendFile(req, reply, storage.coverPath(row.id), { type: 'image/jpeg', cacheControl });
    }
    return reply.type('image/svg+xml').header('Cache-Control', cacheControl).send(generatedCover(row.id));
  });

  // ---- plays, likes, reports --------------------------------------------------
  app.post('/api/tracks/:id/play', limit(120, '1 hour'), async (req) => {
    const row = visibleRow(req, req.params.id);
    if (row.status !== 'published') return { plays: row.plays };
    const key = req.user ? `u${req.user.id}` : `a${sha256(`${req.ip}|${req.headers['user-agent'] || ''}`).slice(0, 16)}`;
    const t = now();
    const counted = db.transaction(() => {
      const seen = db.prepare('SELECT 1 FROM plays_recent WHERE track_id = ? AND key = ? AND at > ?')
        .get(row.id, key, t - PLAY_DEDUPE_MS);
      if (seen) return false;
      db.prepare('INSERT INTO plays_recent (track_id, key, at) VALUES (?,?,?)').run(row.id, key, t);
      db.prepare('UPDATE tracks SET plays = plays + 1 WHERE id = ?').run(row.id);
      return true;
    })();
    return { plays: row.plays + (counted ? 1 : 0), counted };
  });

  app.put('/api/tracks/:id/like', async (req) => {
    const user = requireUser(req);
    const row = visibleRow(req, req.params.id);
    db.transaction(() => {
      const info = db.prepare('INSERT OR IGNORE INTO likes (user_id, track_id, created_at) VALUES (?,?,?)')
        .run(user.id, row.id, now());
      if (info.changes) db.prepare('UPDATE tracks SET likes_count = likes_count + 1 WHERE id = ?').run(row.id);
    })();
    return db.prepare('SELECT likes_count AS likes FROM tracks WHERE id = ?').get(row.id);
  });

  app.delete('/api/tracks/:id/like', async (req) => {
    const user = requireUser(req);
    const row = visibleRow(req, req.params.id);
    db.transaction(() => {
      const info = db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(user.id, row.id);
      if (info.changes) db.prepare('UPDATE tracks SET likes_count = MAX(likes_count - 1, 0) WHERE id = ?').run(row.id);
    })();
    return db.prepare('SELECT likes_count AS likes FROM tracks WHERE id = ?').get(row.id);
  });

  app.post('/api/tracks/:id/report', limit(10, '1 hour'), async (req, reply) => {
    const row = visibleRow(req, req.params.id);
    const body = req.body || {};
    if (!REPORT_REASONS.includes(body.reason)) throw badRequest('invalid_reason', 'Choose a valid reason');
    const open = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE track_id = ? AND status = ?').get(row.id, 'open').n;
    if (open >= 50) return reply.code(202).send({ ok: true });
    db.prepare(
      'INSERT INTO reports (track_id, reporter_id, reason, details, contact, created_at) VALUES (?,?,?,?,?,?)',
    ).run(row.id, req.user?.id ?? null, body.reason, cleanText(body.details, 1000), cleanText(body.contact, 200), now());
    return reply.code(201).send({ ok: true });
  });
}
