import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeApp, call, register, upload, audio, image, multipart, uploadForm } from '../helpers.js';

describe('tracks', () => {
  let ctx; let alice; let bob; let trackId;
  before(async () => {
    ctx = await makeApp({ MAX_TRACK_MINUTES: '2', MAX_UPLOAD_MB: '5' });
    alice = await register(ctx.app, 'alice');
    bob = await register(ctx.app, 'bob');
  });
  after(async () => { await ctx.close(); });

  test('upload requires sign-in', async () => {
    const r = await upload(ctx.app, null);
    assert.equal(r.status, 401);
  });

  test('upload mp3 → transcoded AAC with duration, peaks, searchable', async () => {
    const r = await upload(ctx.app, alice.cookie, { title: 'Neon Rain', lyrics: 'la la lumière' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const t = r.json;
    trackId = t.id;
    assert.equal(t.title, 'Neon Rain');
    assert.equal(t.status, 'published');
    assert.ok(t.duration > 2.5 && t.duration < 3.6, `duration ${t.duration}`);
    assert.equal(t.peaks.length, 160);
    assert.ok(Math.max(...t.peaks) === 100);
    assert.equal(t.artist.username, 'alice');
    assert.equal(t.hasCover, false);
    const file = ctx.app.storage.audioPath(t.id);
    assert.ok(fs.existsSync(file));
    const bytes = fs.readFileSync(file);
    assert.ok(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0, 'starts with an MPEG audio frame sync');
    assert.notEqual(bytes.subarray(0, 3).toString('latin1'), 'ID3', 'no ID3 tag');
    assert.ok(bytes.includes(Buffer.from('Xing')) || bytes.includes(Buffer.from('Info')), 'has a Xing/Info header for accurate seeking');
  });

  for (const [name, getter] of Object.entries({ wav: audio.wav, flac: audio.flac, ogg: audio.ogg, opus: audio.opus, m4a: audio.m4a, 'video with audio': audio.withVideo })) {
    test(`accepts ${name}`, async () => {
      const r = await upload(ctx.app, alice.cookie, { title: `from ${name}` }, getter());
      assert.equal(r.status, 201, JSON.stringify(r.json));
      assert.ok(r.json.duration > 1.5);
    });
  }

  test('strips video stream and metadata from the stored file', async () => {
    const r = await upload(ctx.app, alice.cookie, { title: 'strip' }, audio.withVideo());
    const out = fs.readFileSync(ctx.app.storage.audioPath(r.json.id));
    assert.ok(!out.includes(Buffer.from('avc1')), 'no H.264 video track');
  });

  test('rejects non-audio, video-only, truncated and empty uploads', async () => {
    const text = await upload(ctx.app, alice.cookie, {}, Buffer.from('this is not audio at all'));
    assert.equal(text.status, 400);
    assert.equal(text.json.error.code, 'invalid_audio');
    const vo = await upload(ctx.app, alice.cookie, {}, audio.videoOnly());
    assert.equal(vo.status, 400);
    assert.equal(vo.json.error.code, 'no_audio');
    const cut = await upload(ctx.app, alice.cookie, {}, audio.mp3().subarray(0, 20));
    assert.equal(cut.status, 400);
    const none = multipart({ title: 'x', prompt: 'prompt', confirmAi: 'true' });
    const r = await call(ctx.app, 'POST', '/api/tracks', { cookie: alice.cookie, payload: none.payload, headers: none.headers });
    assert.equal(r.json.error.code, 'missing_audio');
  });

  test('failed uploads leave no files behind', async () => {
    await upload(ctx.app, alice.cookie, {}, Buffer.from('garbage'));
    assert.deepEqual(fs.readdirSync(ctx.app.storage.dirs.tmp), []);
    const files = fs.readdirSync(ctx.app.storage.dirs.audio);
    const rows = ctx.db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n;
    assert.equal(files.length, rows);
  });

  test('rejects tracks longer than MAX_TRACK_MINUTES', async () => {
    const r = await upload(ctx.app, alice.cookie, {}, audio.long());
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'too_long');
  });

  test('rejects files above MAX_UPLOAD_MB with 413', async () => {
    const r = await upload(ctx.app, alice.cookie, {}, Buffer.alloc(6 * 1024 * 1024, 1));
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'too_large');
    assert.deepEqual(fs.readdirSync(ctx.app.storage.dirs.tmp), []);
  });

  test('requires AI confirmation, title and prompt', async () => {
    assert.equal((await upload(ctx.app, alice.cookie, { confirmAi: 'false' })).json.error.code, 'confirmation_required');
    assert.equal((await upload(ctx.app, alice.cookie, { title: '  ' })).json.error.code, 'missing_title');
    assert.equal((await upload(ctx.app, alice.cookie, { prompt: '' })).json.error.code, 'missing_prompt');
    assert.equal((await upload(ctx.app, alice.cookie, { license: 'free-for-all' })).json.error.code, 'invalid_license');
  });

  test('upload with cover is cropped to 640x640 JPEG', async () => {
    const r = await upload(ctx.app, alice.cookie, { title: 'with cover' }, audio.mp3(), {
      cover: { filename: 'c.png', type: 'image/png', data: image.png() },
    });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.hasCover, true);
    const cover = await call(ctx.app, 'GET', `/api/tracks/${r.json.id}/cover`);
    assert.equal(cover.status, 200);
    assert.equal(cover.headers['content-type'], 'image/jpeg');
    assert.equal(cover.raw[0], 0xff);
  });

  test('a non-image cover is rejected and the track is not created', async () => {
    const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n;
    const r = await upload(ctx.app, alice.cookie, {}, audio.mp3(), {
      cover: { filename: 'c.png', type: 'image/png', data: Buffer.from('not an image') },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'invalid_cover');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n, before);
  });

  test('tracks without cover get a generated SVG', async () => {
    const r = await call(ctx.app, 'GET', `/api/tracks/${trackId}/cover`);
    assert.equal(r.headers['content-type'], 'image/svg+xml');
    assert.match(r.res.body, /<svg/);
    assert.ok(!/<script|onload/i.test(r.res.body));
  });

  test('cover can be replaced and removed by the owner', async () => {
    const form = multipart({}, { cover: { filename: 'c.png', type: 'image/png', data: image.png() } });
    const put = await call(ctx.app, 'PUT', `/api/tracks/${trackId}/cover`, { cookie: alice.cookie, payload: form.payload, headers: form.headers });
    assert.equal(put.status, 200);
    assert.equal(put.json.hasCover, true);
    const forbid = await call(ctx.app, 'PUT', `/api/tracks/${trackId}/cover`, { cookie: bob.cookie, payload: form.payload, headers: form.headers });
    assert.equal(forbid.status, 403);
    const del = await call(ctx.app, 'DELETE', `/api/tracks/${trackId}/cover`, { cookie: alice.cookie });
    assert.equal(del.json.hasCover, false);
  });

  test('streaming: full, Range, suffix range, 416, ETag 304', async () => {
    const url = `/api/tracks/${trackId}/stream`;
    const full = await call(ctx.app, 'GET', url);
    assert.equal(full.status, 200);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(full.headers['content-type'], 'audio/mpeg');
    const size = full.raw.length;
    assert.equal(Number(full.headers['content-length']), size);

    const part = await call(ctx.app, 'GET', url, { headers: { range: 'bytes=0-99' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 0-99/${size}`);
    assert.equal(part.raw.length, 100);
    assert.deepEqual(part.raw, full.raw.subarray(0, 100));

    const open = await call(ctx.app, 'GET', url, { headers: { range: `bytes=${size - 10}-` } });
    assert.equal(open.status, 206);
    assert.deepEqual(open.raw, full.raw.subarray(size - 10));

    const suffix = await call(ctx.app, 'GET', url, { headers: { range: 'bytes=-50' } });
    assert.equal(suffix.raw.length, 50);

    const over = await call(ctx.app, 'GET', url, { headers: { range: `bytes=${size + 5}-` } });
    assert.equal(over.status, 416);
    const garbage = await call(ctx.app, 'GET', url, { headers: { range: 'bytes=abc' } });
    assert.equal(garbage.status, 416);

    const again = await call(ctx.app, 'GET', url, { headers: { 'if-none-match': full.headers.etag } });
    assert.equal(again.status, 304);
  });

  test('track detail and list', async () => {
    const d = await call(ctx.app, 'GET', `/api/tracks/${trackId}`);
    assert.equal(d.json.lyrics, 'la la lumière');
    const list = await call(ctx.app, 'GET', '/api/tracks?sort=new&limit=3');
    assert.equal(list.json.items.length, 3);
    assert.ok(list.json.total >= 8);
    assert.equal(list.json.items[0].peaks, undefined, 'lists do not carry peaks');
    assert.equal((await call(ctx.app, 'GET', '/api/tracks/does-not-exist')).status, 404);
    assert.equal((await call(ctx.app, 'GET', '/api/tracks/..%2F..%2Fetc')).status, 404);
  });

  test('full-text search: prefix, diacritics, genre, artist, empty and hostile queries', async () => {
    const find = async (q) => (await call(ctx.app, 'GET', `/api/tracks?q=${encodeURIComponent(q)}`)).json;
    assert.equal((await find('neon')).items[0].id, trackId);
    assert.equal((await find('Neo')).items[0].id, trackId, 'prefix match');
    assert.equal((await find('lumiere')).items[0].id, trackId, 'diacritics-insensitive');
    assert.ok((await find('synthwave')).total > 0, 'genre');
    assert.ok((await find('alice')).total > 0, 'artist');
    assert.equal((await find('zzzznotfound')).total, 0);
    for (const hostile of ['"', "'", '*', 'a OR b', 'NEAR(', '" OR 1=1 --', '\\', '%', '(((', 'title:x', '^']) {
      const r = await call(ctx.app, 'GET', `/api/tracks?q=${encodeURIComponent(hostile)}`);
      assert.equal(r.status, 200, `query ${hostile}`);
    }
    const all = await call(ctx.app, 'GET', '/api/tracks?q=');
    assert.ok(all.json.total > 0);
  });

  test('sorting, genre filter, pagination, artist filter', async () => {
    const byTitle = (await call(ctx.app, 'GET', '/api/tracks?sort=title&limit=100')).json.items.map((t) => t.title.toLowerCase());
    assert.deepEqual(byTitle, [...byTitle].sort((a, b) => a.localeCompare(b)));
    const p1 = (await call(ctx.app, 'GET', '/api/tracks?limit=2&offset=0')).json.items;
    const p2 = (await call(ctx.app, 'GET', '/api/tracks?limit=2&offset=2')).json.items;
    assert.notEqual(p1[0].id, p2[0].id);
    const genre = await call(ctx.app, 'GET', '/api/tracks?genre=synthwave');
    assert.ok(genre.json.total > 0);
    const none = await call(ctx.app, 'GET', '/api/tracks?artist=bob');
    assert.equal(none.json.total, 0);
    const genres = await call(ctx.app, 'GET', '/api/genres');
    assert.equal(genres.json.items[0].name.toLowerCase(), 'synthwave');
    const artists = await call(ctx.app, 'GET', '/api/artists');
    assert.equal(artists.json.items[0].username, 'alice');
    assert.equal((await call(ctx.app, 'GET', '/api/artists?q=ali')).json.items.length, 1);
    assert.equal((await call(ctx.app, 'GET', '/api/artists/alice')).json.tracks > 0, true);
    assert.equal((await call(ctx.app, 'GET', '/api/artists/ghost')).status, 404);
  });

  test('likes: idempotent, counted, listed, require sign-in', async () => {
    assert.equal((await call(ctx.app, 'PUT', `/api/tracks/${trackId}/like`)).status, 401);
    await call(ctx.app, 'PUT', `/api/tracks/${trackId}/like`, { cookie: bob.cookie });
    const twice = await call(ctx.app, 'PUT', `/api/tracks/${trackId}/like`, { cookie: bob.cookie });
    assert.equal(twice.json.likes, 1);
    await call(ctx.app, 'PUT', `/api/tracks/${trackId}/like`, { cookie: alice.cookie });
    const bobView = await call(ctx.app, 'GET', `/api/tracks/${trackId}`, { cookie: bob.cookie });
    assert.equal(bobView.json.liked, true);
    assert.equal(bobView.json.likes, 2);
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${trackId}`)).json.liked, false);
    const liked = await call(ctx.app, 'GET', '/api/tracks?liked=1', { cookie: bob.cookie });
    assert.deepEqual(liked.json.items.map((t) => t.id), [trackId]);
    const un = await call(ctx.app, 'DELETE', `/api/tracks/${trackId}/like`, { cookie: bob.cookie });
    assert.equal(un.json.likes, 1);
    const unTwice = await call(ctx.app, 'DELETE', `/api/tracks/${trackId}/like`, { cookie: bob.cookie });
    assert.equal(unTwice.json.likes, 1);
  });

  test('plays are counted once per listener per 30 minutes', async () => {
    const a = await call(ctx.app, 'POST', `/api/tracks/${trackId}/play`, { cookie: bob.cookie, body: {} });
    assert.equal(a.json.counted, true);
    const b = await call(ctx.app, 'POST', `/api/tracks/${trackId}/play`, { cookie: bob.cookie, body: {} });
    assert.equal(b.json.counted, false);
    assert.equal(b.json.plays, a.json.plays);
    const anon = await call(ctx.app, 'POST', `/api/tracks/${trackId}/play`, { body: {} });
    assert.equal(anon.json.counted, true);
    const again = await call(ctx.app, 'POST', `/api/tracks/${trackId}/play`, { body: {} });
    assert.equal(again.json.counted, false);
  });

  test('edit: owner and moderator only, search index follows', async () => {
    const denied = await call(ctx.app, 'PATCH', `/api/tracks/${trackId}`, { cookie: bob.cookie, body: { title: 'hijack' } });
    assert.equal(denied.status, 403);
    const anon = await call(ctx.app, 'PATCH', `/api/tracks/${trackId}`, { body: { title: 'hijack' } });
    assert.equal(anon.status, 401);
    const ok = await call(ctx.app, 'PATCH', `/api/tracks/${trackId}`, { cookie: alice.cookie, body: { title: 'Midnight Oil', genre: 'Ambient', license: 'non_commercial' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.title, 'Midnight Oil');
    assert.equal(ok.json.license, 'non_commercial');
    assert.equal((await call(ctx.app, 'GET', '/api/tracks?q=midnight')).json.items[0].id, trackId);
    assert.equal((await call(ctx.app, 'GET', '/api/tracks?q=neon')).json.items.filter((t) => t.id === trackId).length, 0);
    const bad = await call(ctx.app, 'PATCH', `/api/tracks/${trackId}`, { cookie: alice.cookie, body: { title: '   ' } });
    assert.equal(bad.status, 400);
  });

  test('display-name change re-indexes artist search', async () => {
    await call(ctx.app, 'PATCH', '/api/me', { cookie: alice.cookie, body: { displayName: 'Aurora Borealis' } });
    assert.ok((await call(ctx.app, 'GET', '/api/tracks?q=aurora')).json.total > 0);
  });

  test('delete: owner only, removes files, rows, likes and index', async () => {
    const r = await upload(ctx.app, bob.cookie, { title: 'Disposable' });
    const id = r.json.id;
    assert.equal((await call(ctx.app, 'DELETE', `/api/tracks/${id}`, { cookie: alice.cookie })).status, 200, 'admin (moderator) may delete');
    const r2 = await upload(ctx.app, bob.cookie, { title: 'Disposable two' });
    const id2 = r2.json.id;
    assert.equal((await call(ctx.app, 'DELETE', `/api/tracks/${id2}`, { cookie: bob.cookie })).status, 200);
    for (const x of [id, id2]) {
      assert.ok(!fs.existsSync(ctx.app.storage.audioPath(x)));
      assert.equal((await call(ctx.app, 'GET', `/api/tracks/${x}`)).status, 404);
    }
    assert.equal((await call(ctx.app, 'GET', '/api/tracks?q=disposable')).json.total, 0);
  });

  test('SQL injection attempts in params are harmless', async () => {
    for (const q of ["' OR '1'='1", '1; DROP TABLE tracks;--']) {
      for (const key of ['genre', 'artist', 'sort', 'q']) {
        const r = await call(ctx.app, 'GET', `/api/tracks?${key}=${encodeURIComponent(q)}`);
        assert.equal(r.status, 200);
      }
    }
    assert.ok(ctx.db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n > 0);
  });

  test('stored XSS payloads are returned as inert JSON text', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const r = await upload(ctx.app, alice.cookie, { title: payload, prompt: payload });
    assert.equal(r.json.title, payload);
    assert.match(r.headers['content-type'], /application\/json/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  });
});

describe('upload policy and moderation queue', () => {
  test('UPLOAD_POLICY=admins blocks regular users', async () => {
    const c = await makeApp({ UPLOAD_POLICY: 'admins' });
    try {
      const admin = await register(c.app, 'root');
      const user = await register(c.app, 'plain');
      const denied = await upload(c.app, user.cookie);
      assert.equal(denied.status, 403);
      assert.equal((await upload(c.app, admin.cookie)).status, 201);
      assert.equal((await call(c.app, 'GET', '/api/config', { cookie: user.cookie })).json.canUpload, false);
      assert.equal((await call(c.app, 'GET', '/api/config', { cookie: admin.cookie })).json.canUpload, true);
    } finally { await c.close(); }
  });

  test('REQUIRE_APPROVAL: pending tracks are hidden until approved', async () => {
    const c = await makeApp({ REQUIRE_APPROVAL: 'true' });
    try {
      const admin = await register(c.app, 'root');
      const user = await register(c.app, 'plain');
      const other = await register(c.app, 'other');
      const up = await upload(c.app, user.cookie, { title: 'Queued' });
      assert.equal(up.json.status, 'pending');
      const id = up.json.id;
      assert.equal((await call(c.app, 'GET', '/api/tracks')).json.total, 0);
      assert.equal((await call(c.app, 'GET', `/api/tracks/${id}`)).status, 404);
      assert.equal((await call(c.app, 'GET', `/api/tracks/${id}/stream`)).status, 404);
      assert.equal((await call(c.app, 'GET', `/api/tracks/${id}`, { cookie: other.cookie })).status, 404);
      assert.equal((await call(c.app, 'GET', `/api/tracks/${id}`, { cookie: user.cookie })).status, 200, 'owner sees own');
      assert.equal((await call(c.app, 'GET', `/api/tracks/${id}/stream`, { cookie: user.cookie })).status, 200);
      assert.equal((await call(c.app, 'GET', '/api/tracks/mine', { cookie: user.cookie })).json.items.length, 1);
      assert.equal((await call(c.app, 'GET', '/api/admin/tracks?status=pending', { cookie: user.cookie })).status, 403);
      const queue = await call(c.app, 'GET', '/api/admin/tracks?status=pending', { cookie: admin.cookie });
      assert.equal(queue.json.items.length, 1);
      assert.equal((await call(c.app, 'POST', `/api/admin/tracks/${id}/status`, { cookie: admin.cookie, body: { status: 'published' } })).status, 200);
      assert.equal((await call(c.app, 'GET', '/api/tracks')).json.total, 1);
      assert.equal((await upload(c.app, admin.cookie)).json.status, 'published', 'admins bypass the queue');
    } finally { await c.close(); }
  });
});

test('uploadForm helper builds valid multipart', () => {
  const f = uploadForm();
  assert.ok(f.headers['content-type'].startsWith('multipart/form-data'));
});
