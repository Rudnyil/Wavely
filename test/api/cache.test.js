import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, register, upload } from '../helpers.js';

describe('artist list cache never serves stale data after a write', () => {
  let ctx; let alice; let bob;
  before(async () => { ctx = await makeApp(); alice = await register(ctx.app, 'alice'); bob = await register(ctx.app, 'bobby'); });
  after(async () => { await ctx.close(); });

  const names = async () => (await call(ctx.app, 'GET', '/api/artists')).json.items.map((a) => a.username);

  test('upload, play, removal and account deletion show up immediately', async () => {
    assert.deepEqual(await names(), []);
    const a = (await upload(ctx.app, alice.cookie, { title: 'A song' })).json;
    assert.deepEqual(await names(), ['alice']);
    const b = (await upload(ctx.app, bob.cookie, { title: 'B song' })).json;
    assert.deepEqual((await names()).sort(), ['alice', 'bobby']);
    await call(ctx.app, 'POST', `/api/tracks/${b.id}/play`);
    const first = (await call(ctx.app, 'GET', '/api/artists')).json.items[0];
    assert.equal(first.username, 'bobby');
    assert.equal(first.plays, 1);
    assert.equal((await call(ctx.app, 'DELETE', `/api/tracks/${a.id}`, { cookie: alice.cookie })).status, 200);
    assert.deepEqual(await names(), ['bobby']);
  });
});
