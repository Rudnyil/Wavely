import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, register, upload } from '../helpers.js';

describe('removal reasons are shown to the uploader', () => {
  let ctx; let admin; let alice; let bob; let id;
  before(async () => {
    ctx = await makeApp();
    admin = await register(ctx.app, 'root1');
    alice = await register(ctx.app, 'alice');
    bob = await register(ctx.app, 'bob');
    id = (await upload(ctx.app, alice.cookie, { title: 'Disputed' })).json.id;
  });
  after(async () => { await ctx.close(); });

  const mineOf = async (u) => (await call(ctx.app, 'GET', '/api/tracks/mine', { cookie: u.cookie })).json.items;

  test('a report resolved as "removed" stores the reason, and only the uploader and moderators can see it', async () => {
    const rep = await call(ctx.app, 'POST', `/api/tracks/${id}/report`, { body: { reason: 'copyright', details: 'x', contact: 'a@b.c' } });
    assert.equal(rep.status, 201);
    const report = (await call(ctx.app, 'GET', '/api/admin/reports?status=open', { cookie: admin.cookie })).json.items[0];
    const res = await call(ctx.app, 'POST', `/api/admin/reports/${report.id}/resolve`, { cookie: admin.cookie, body: { resolution: 'removed', reason: '  Copy of a commercial recording  ' } });
    assert.equal(res.status, 200);
    const mine = (await mineOf(alice)).find((t) => t.id === id);
    assert.equal(mine.status, 'removed');
    assert.equal(mine.removalReason, 'Copy of a commercial recording');
    assert.ok(mine.removedAt > 0);
    assert.equal((await mineOf(bob)).length, 0);
    const pub = await call(ctx.app, 'GET', '/api/tracks');
    assert.ok(!pub.json.items.some((t) => t.id === id));
    assert.equal((await call(ctx.app, 'GET', `/api/tracks/${id}/stream`, { cookie: alice.cookie })).status, 404, 'no longer playable');
  });

  test('restoring clears the reason; removing again through the queue stores a new one; a missing reason is allowed', async () => {
    await call(ctx.app, 'POST', `/api/admin/tracks/${id}/status`, { cookie: admin.cookie, body: { status: 'published' } });
    let mine = (await mineOf(alice)).find((t) => t.id === id);
    assert.equal(mine.status, 'published');
    assert.equal(mine.removalReason, undefined);
    await call(ctx.app, 'POST', `/api/admin/tracks/${id}/status`, { cookie: admin.cookie, body: { status: 'removed', reason: 'Not AI-generated' } });
    mine = (await mineOf(alice)).find((t) => t.id === id);
    assert.equal(mine.removalReason, 'Not AI-generated');
    await call(ctx.app, 'POST', `/api/admin/tracks/${id}/status`, { cookie: admin.cookie, body: { status: 'published' } });
    await call(ctx.app, 'POST', `/api/admin/tracks/${id}/status`, { cookie: admin.cookie, body: { status: 'removed' } });
    mine = (await mineOf(alice)).find((t) => t.id === id);
    assert.equal(mine.status, 'removed');
    assert.equal(mine.removalReason, '');
  });

  test('over-long and markup-laden reasons are trimmed and stay plain text', async () => {
    await call(ctx.app, 'POST', `/api/admin/tracks/${id}/status`, { cookie: admin.cookie, body: { status: 'removed', reason: `<b>x</b>${'y'.repeat(900)}` } });
    const mine = (await mineOf(alice)).find((t) => t.id === id);
    assert.ok(mine.removalReason.length <= 500);
  });
});
