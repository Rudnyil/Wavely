import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../server/config.js';
import { makeApp, call } from '../helpers.js';

test('contact email and legal URL are validated', () => {
  assert.equal(loadConfig({ CONTACT_EMAIL: 'abuse@example.org', LEGAL_URL: 'https://example.org/terms' }).contactEmail, 'abuse@example.org');
  assert.equal(loadConfig({}).contactEmail, '');
  assert.throws(() => loadConfig({ CONTACT_EMAIL: 'not an email' }), /CONTACT_EMAIL/);
  assert.throws(() => loadConfig({ CONTACT_EMAIL: 'a@b.c"><script>' }), /CONTACT_EMAIL/);
  assert.throws(() => loadConfig({ LEGAL_URL: 'javascript:alert(1)' }), /LEGAL_URL/);
  assert.throws(() => loadConfig({ LEGAL_URL: 'example.org/terms' }), /LEGAL_URL/);
});

test('/api/config exposes them to the About page', async () => {
  const ctx = await makeApp({ CONTACT_EMAIL: 'abuse@example.org', LEGAL_URL: 'https://example.org/terms' });
  try {
    const r = await call(ctx.app, 'GET', '/api/config');
    assert.equal(r.json.contactEmail, 'abuse@example.org');
    assert.equal(r.json.legalUrl, 'https://example.org/terms');
  } finally { await ctx.close(); }
});
