import { notFound } from '../errors.js';
import { clampInt } from '../util.js';

export const VERSION = '0.1.0';

export default async function metaRoutes(app) {
  const { db, config } = app;

  const health = async () => {
    db.prepare('SELECT 1').get();
    return { status: 'ok', version: VERSION, ffmpeg: app.ffmpegOk };
  };
  app.get('/healthz', { config: { rateLimit: false } }, health);
  app.get('/api/health', { config: { rateLimit: false } }, health);

  app.get('/api/config', async (req) => {
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const user = req.user;
    return {
      name: config.instanceName,
      contactEmail: config.contactEmail,
      legalUrl: config.legalUrl,
      version: VERSION,
      registration: config.registration,
      uploadPolicy: config.uploadPolicy,
      requireApproval: config.requireApproval,
      maxUploadMb: config.maxUploadMb,
      maxTrackMinutes: config.maxTrackMinutes,
      needsSetup: users === 0,
      canUpload: !!user && (config.uploadPolicy === 'users' || user.role === 'admin'),
    };
  });

  app.get('/api/genres', async () => {
    const rows = db.prepare(
      `SELECT genre AS name, COUNT(*) AS tracks FROM tracks
        WHERE status = 'published' AND genre != ''
        GROUP BY genre COLLATE NOCASE ORDER BY tracks DESC, genre COLLATE NOCASE LIMIT 60`,
    ).all();
    return { items: rows };
  });

  const artistCache = new Map();
  app.get('/api/artists', async (req) => {
    const { q } = req.query;
    const cacheKey = `${q || ''}|${req.query.limit || ''}`;
    const hit = artistCache.get(cacheKey);
    if (hit && hit.version === app.dataVersion && Date.now() - hit.at < 60000) return hit.value;
    const version = app.dataVersion;
    const limit = clampInt(req.query.limit, 40, 1, 100);
    const params = { limit };
    let filter = '';
    if (q) {
      const term = String(q).replace(/[\\%_]/g, (c) => '\\' + c).slice(0, 60);
      filter = "AND (u.username LIKE @like ESCAPE '\\' OR u.display_name LIKE @like ESCAPE '\\')";
      params.like = `%${term}%`;
    }
    const rows = db.prepare(
      `SELECT u.username, u.display_name AS displayName, COUNT(t.id) AS tracks, COALESCE(SUM(t.plays),0) AS plays
         FROM users u JOIN tracks t ON t.user_id = u.id AND t.status = 'published'
        WHERE u.disabled = 0 ${filter}
        GROUP BY u.id ORDER BY plays DESC, tracks DESC LIMIT @limit`,
    ).all(params);
    const value = { items: rows };
    if (artistCache.size > 200) artistCache.clear();
    artistCache.set(cacheKey, { version, at: Date.now(), value });
    return value;
  });

  app.get('/api/artists/:username', async (req) => {
    const row = db.prepare(
      `SELECT u.username, u.display_name AS displayName, u.bio, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id AND t.status = 'published') AS tracks,
              (SELECT COALESCE(SUM(plays),0) FROM tracks t WHERE t.user_id = u.id AND t.status = 'published') AS plays
         FROM users u WHERE u.username = ? AND u.disabled = 0`,
    ).get(String(req.params.username));
    if (!row) throw notFound('Artist not found');
    return row;
  });
}
