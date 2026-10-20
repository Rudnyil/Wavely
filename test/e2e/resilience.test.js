import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch } from './helpers.js';

let server; let browser;
before(async () => { server = await startServer(); browser = await launch(); });
after(async () => { await browser?.close(); await server?.stop(); });

describe('failing API calls', () => {
  test('a persistent failure shows an error with a retry button, never a crash', async () => {
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/tracks?*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"boom","message":"boom"}}' }));
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Try again' }).waitFor();
    assert.deepEqual(errors, []);
    // Once the API works again, retry recovers the page.
    await page.unroute('**/api/tracks?*');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('button', { name: 'Try again' }).waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  });

  test('a dropped connection is retried once automatically', async () => {
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let dropped = 0;
    await page.route('**/api/tracks?*', (route) => { if (dropped++ < 2) return route.abort('connectionreset'); return route.continue(); });
    await page.goto(server.url);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByRole('button', { name: 'Try again' }).count(), 0);
    assert.deepEqual(errors, []);
  });
});
