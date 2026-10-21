import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../server/db.js';
import { LoginThrottle } from '../../server/auth.js';
import { makeApp, call, register } from '../helpers.js';

test('failed logins are counted per username, case-insensitively, and survive a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavely-thr-'));
  const file = path.join(dir, 'wavely.db');
  try {
    let db = openDb(file);
    let t = new LoginThrottle(db, { max: 3, windowMs: 60000 });
    t.fail('Alice'); t.fail('alice');
    assert.equal(t.blocked('ALICE'), false);
    t.fail('alice');
    assert.equal(t.blocked('alice'), true);
    assert.equal(t.blocked('bob'), false);
    db.close();
    db = openDb(file); // "restart"
    t = new LoginThrottle(db, { max: 3, windowMs: 60000 });
    assert.equal(t.blocked('alice'), true, 'still blocked after reopening the database');
    t.reset('alice');
    assert.equal(t.blocked('alice'), false);
    db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a block expires after the window', () => {
  const db = openDb(':memory:');
  const t = new LoginThrottle(db, { max: 1, windowMs: 1 });
  t.fail('carol');
  return new Promise((resolve) => setTimeout(() => { assert.equal(t.blocked('carol'), false); resolve(); }, 20));
});

test('login endpoint blocks after repeated failures even with the right password afterwards', async () => {
  const ctx = await makeApp();
  try {
    await register(ctx.app, 'dave');
    for (let i = 0; i < 8; i += 1) {
      const r = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'dave', password: 'wrong password!' } });
      assert.equal(r.status, 401);
    }
    const blocked = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'dave', password: 'correct horse battery' } });
    assert.equal(blocked.status, 429);
  } finally { await ctx.close(); }
});
