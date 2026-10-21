import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeApp, register, upload, audio, image, multipart, call } from '../helpers.js';

describe('hostile uploads', () => {
  let ctx; let user;
  before(async () => { ctx = await makeApp(); user = await register(ctx.app, 'mallory'); });
  after(async () => { await ctx.close(); });

  const text = (s) => Buffer.from(s);

  test('playlist-like files that make ffmpeg follow references are refused', async () => {
    const cases = {
      concat: 'ffconcat version 1.0\nfile ../audio/other.mp3\n',
      hls: '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile:///etc/hostname\n#EXT-X-ENDLIST\n',
      sdp: 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=x\nc=IN IP4 127.0.0.1\nt=0 0\nm=audio 5004 RTP/AVP 0\n',
      text: 'just some text\n',
    };
    for (const [name, content] of Object.entries(cases)) {
      const r = await upload(ctx.app, user.cookie, { title: name }, text(content));
      assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.json)}`);
    }
    assert.equal(fs.readdirSync(ctx.config.dataDir + '/audio').length, 0);
  });

  test('an image with an enormous pixel count is refused before decoding', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-bomb-'));
    try {
      const bomb = path.join(dir, 'bomb.png');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=14000x14000:d=1', '-frames:v', '1', bomb]);
      assert.ok(fs.statSync(bomb).size < 5 * 1024 * 1024, 'bomb stays small on disk');
      const r = await upload(ctx.app, user.cookie, { title: 'bomb' }, audio.mp3(), { cover: { data: fs.readFileSync(bomb), filename: 'c.png', type: 'image/png' } });
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, 'cover_too_large');
      assert.equal(fs.readdirSync(ctx.config.dataDir + '/audio').length, 0);
      const ok = await upload(ctx.app, user.cookie, { title: 'fine' }, audio.mp3(), { cover: { data: image.png(), filename: 'c.png', type: 'image/png' } });
      assert.equal(ok.status, 201);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('path-like track ids never reach the file system', async () => {
    for (const id of ['..%2f..%2fetc%2fpasswd', '%2e%2e', 'a'.repeat(200)]) {
      for (const suffix of ['', '/stream', '/cover']) {
        const r = await call(ctx.app, 'GET', `/api/tracks/${id}${suffix}`);
        assert.ok([400, 404].includes(r.status), `${id}${suffix} -> ${r.status}`);
      }
    }
  });
});
