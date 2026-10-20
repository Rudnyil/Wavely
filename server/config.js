import path from 'node:path';

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off', '']);

function bool(name, value, fallback) {
  if (value === undefined) return fallback;
  const s = String(value).trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  throw new Error(`${name} must be true or false, got "${value}"`);
}

function int(name, value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${value}"`);
  }
  return n;
}

function oneOf(name, value, fallback, allowed) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

/**
 * Reads and validates configuration from environment variables.
 * Every option has a safe default, so a bare `npm start` works.
 */
export function loadConfig(env = process.env) {
  const baseUrl = (env.BASE_URL || '').trim().replace(/\/+$/, '');
  const config = {
    port: int('PORT', env.PORT, 3000, { min: 0, max: 65535 }),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || './data'),
    baseUrl,
    instanceName: (env.INSTANCE_NAME || 'Wavely').trim().slice(0, 40) || 'Wavely',
    registration: oneOf('REGISTRATION', env.REGISTRATION, 'open', ['open', 'invite', 'closed']),
    inviteCode: env.INVITE_CODE || '',
    uploadPolicy: oneOf('UPLOAD_POLICY', env.UPLOAD_POLICY, 'users', ['users', 'admins']),
    requireApproval: bool('REQUIRE_APPROVAL', env.REQUIRE_APPROVAL, false),
    maxUploadMb: int('MAX_UPLOAD_MB', env.MAX_UPLOAD_MB, 100, { min: 1, max: 2000 }),
    maxCoverMb: 5,
    maxTrackMinutes: int('MAX_TRACK_MINUTES', env.MAX_TRACK_MINUTES, 20, { min: 1, max: 240 }),
    sessionDays: int('SESSION_DAYS', env.SESSION_DAYS, 30, { min: 1, max: 365 }),
    trustProxy: bool('TRUST_PROXY', env.TRUST_PROXY, false),
    cookieSecure: bool('COOKIE_SECURE', env.COOKIE_SECURE, baseUrl.startsWith('https://')),
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH || 'ffprobe',
    transcodeConcurrency: int('TRANSCODE_CONCURRENCY', env.TRANSCODE_CONCURRENCY, 2, { min: 1, max: 16 }),
    rateLimit: bool('RATE_LIMIT', env.RATE_LIMIT, true),
    logLevel: env.LOG_LEVEL || 'info',
  };
  if (config.registration === 'invite' && !config.inviteCode) {
    throw new Error('REGISTRATION=invite requires INVITE_CODE to be set');
  }
  return Object.freeze(config);
}
