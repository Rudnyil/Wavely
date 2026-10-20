import crypto from 'node:crypto';

export const now = () => Date.now();

/** Short URL-safe random id (12 characters for 9 bytes). */
export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Control characters (except tab and newline) and invisible bidirectional overrides,
// which are used to disguise text in titles and names.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Normalizes user text: NFC, unified newlines, no control or bidi override characters, trimmed. */
export function cleanText(value, maxLength) {
  let s = typeof value === 'string' ? value : value == null ? '' : String(value);
  s = s.normalize('NFC').replace(/\r\n?/g, '\n').replace(UNSAFE_CHARS, '').trim();
  if (maxLength && s.length > maxLength) s = s.slice(0, maxLength).trim();
  return s;
}

export function timingSafeEqualStr(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x);
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

/** Tiny counting semaphore used to cap parallel ffmpeg jobs. */
export class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.active >= this.limit) await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
