import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Semaphore } from './util.js';
import { badRequest } from './errors.js';

const PEAK_COUNT = 160;
// Containers accepted for uploads. Anything else (HLS/DASH playlists, concat lists, SDP, image sequences, ...) can make
// ffmpeg follow references inside the file, so it is refused before the file is decoded.
const AUDIO_FORMATS = new Set([
  'mp3', 'wav', 'w64', 'flac', 'ogg', 'oga', 'opus', 'matroska', 'webm', 'mov', 'mp4', 'm4a', '3gp', 'aac', 'adts', 'aiff',
  'ac3', 'eac3', 'ape', 'wv', 'caf', 'asf', 'amr', 'tta', 'dsf', 'mpeg', 'mp2',
]);
const MAX_COVER_SIDE = 12000;
const MAX_COVER_PIXELS = 40e6;

/** Runs a binary without a shell and collects output; kills it after timeoutMs. */
export function run(bin, args, { timeoutMs = 10 * 60 * 1000, binary = false, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let outSize = 0;
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => {
      outSize += d.length;
      if (outSize > maxBytes) { child.kill('SIGKILL'); return; }
      out.push(d);
    });
    child.stderr.on('data', (d) => { if (err.length < 8000) err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code === 0) resolve(binary ? buf : buf.toString('utf8'));
      else reject(Object.assign(new Error(`${bin} exited with ${code}: ${err.slice(-500)}`), { code, stderr: err }));
    });
  });
}

export function createMedia(config) {
  const sem = new Semaphore(config.transcodeConcurrency);
  const guard = ['-protocol_whitelist', 'file'];

  async function probe(file) {
    let raw;
    try {
      raw = await run(config.ffprobePath, [
        '-v', 'error', ...guard, '-print_format', 'json', '-show_format', '-show_streams', file,
      ], { timeoutMs: 30000 });
    } catch {
      throw badRequest('invalid_audio', 'The file is not a readable audio file');
    }
    let info;
    try { info = JSON.parse(raw); } catch { throw badRequest('invalid_audio', 'The file is not a readable audio file'); }
    const formats = String(info.format?.format_name || '').split(',');
    if (!formats.some((f) => AUDIO_FORMATS.has(f))) throw badRequest('invalid_audio', 'This audio format is not supported');
    const audio = (info.streams || []).find((s) => s.codec_type === 'audio');
    if (!audio) throw badRequest('no_audio', 'The file does not contain an audio track');
    const duration = Number(info.format?.duration || audio.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw badRequest('invalid_audio', 'Could not determine the track duration');
    return { duration, codec: audio.codec_name };
  }

  /**
   * Transcodes any audio into constant-bitrate MP3: it plays in every browser (including those without AAC/Opus
   * support), seeks accurately with HTTP Range requests, and carries no metadata of the source file.
   */
  function transcode(input, output, maxSeconds) {
    return sem.run(() => run(config.ffmpegPath, [
      '-nostdin', '-y', '-v', 'error', ...guard, '-i', input,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
      '-t', String(maxSeconds),
      '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      '-id3v2_version', '0', '-write_xing', '1', '-f', 'mp3', output,
    ]));
  }

  /** Returns PEAK_COUNT integers 0..100 describing loudness over time (for the waveform). */
  async function peaks(file, duration) {
    const raw = await sem.run(() => run(config.ffmpegPath, [
      '-nostdin', '-v', 'error', ...guard, '-i', file, '-map', '0:a:0',
      '-ac', '1', '-ar', '8000', '-f', 's16le', '-',
    ], { binary: true, timeoutMs: 5 * 60 * 1000, maxBytes: 8000 * 2 * 60 * 60 * 5 }));
    const samples = Math.floor(raw.length / 2);
    if (samples === 0) return new Array(PEAK_COUNT).fill(0);
    const per = samples / PEAK_COUNT;
    const out = [];
    let max = 1;
    for (let i = 0; i < PEAK_COUNT; i += 1) {
      const start = Math.floor(i * per);
      const end = Math.max(start + 1, Math.floor((i + 1) * per));
      let sum = 0;
      let n = 0;
      for (let j = start; j < end && j < samples; j += 1) {
        const v = raw.readInt16LE(j * 2);
        sum += v * v;
        n += 1;
      }
      const rms = n ? Math.sqrt(sum / n) : 0;
      out.push(rms);
      if (rms > max) max = rms;
    }
    void duration;
    return out.map((v) => Math.round((v / max) * 100));
  }

  /** Crops and scales any image to a 640x640 JPEG. Rejects files that are not images. */
  async function cover(input, output) {
    // Refuse huge images before decoding: a small PNG can expand to gigabytes of pixels.
    try {
      const raw = await run(config.ffprobePath, [
        '-v', 'error', ...guard, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-print_format', 'json', input,
      ], { timeoutMs: 15000 });
      const { width, height } = JSON.parse(raw).streams?.[0] || {};
      if (!(width > 0 && height > 0)) throw new Error('no image');
      if (width > MAX_COVER_SIDE || height > MAX_COVER_SIDE || width * height > MAX_COVER_PIXELS) {
        throw badRequest('cover_too_large', 'The cover image has too many pixels (maximum about 40 megapixels)');
      }
    } catch (e) {
      if (e.code === 'cover_too_large' || e.status === 400) throw e;
      throw badRequest('invalid_cover', 'The cover must be a PNG, JPEG, WebP or GIF image');
    }
    try {
      await sem.run(() => run(config.ffmpegPath, [
        '-nostdin', '-y', '-v', 'error', ...guard, '-i', input, '-frames:v', '1',
        '-vf', "scale=640:640:force_original_aspect_ratio=increase,crop=640:640",
        '-q:v', '3', '-f', 'image2', '-update', '1', output,
      ], { timeoutMs: 30000 }));
    } catch {
      throw badRequest('invalid_cover', 'The cover must be a PNG, JPEG, WebP or GIF image');
    }
    if (!fs.existsSync(output)) throw badRequest('invalid_cover', 'The cover must be an image');
  }

  async function available() {
    try {
      await run(config.ffmpegPath, ['-version'], { timeoutMs: 5000 });
      await run(config.ffprobePath, ['-version'], { timeoutMs: 5000 });
      return true;
    } catch { return false; }
  }

  return { probe, transcode, peaks, cover, available };
}
