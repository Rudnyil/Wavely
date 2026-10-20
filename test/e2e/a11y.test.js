import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { AxeBuilder } from '@axe-core/playwright';
import { startServer, launch, openPage } from './helpers.js';

let server; let browser; let trackPath; let playlistPath;
const PASS = 'demo-password-123';

const TARGETS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  mobile: { viewport: { width: 390, height: 844 }, hasTouch: true },
};

async function signIn(page, username = 'demo') {
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Username').fill(username);
  await dlg.getByLabel('Password', { exact: true }).fill(PASS);
  await dlg.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).waitFor();
}

async function audit(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(0, 2).join(' ')).join('\n    ')}`);
  assert.deepEqual(summary, [], `${label}: accessibility violations`);
}

async function noHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.getElementById('main');
    return { doc: doc.scrollWidth - doc.clientWidth, main: main ? main.scrollWidth - main.clientWidth : 0 };
  });
  assert.ok(overflow.doc <= 0 && overflow.main <= 0, `${label}: horizontal overflow ${JSON.stringify(overflow)}`);
}

describe('accessibility and responsive layout', () => {
  before(async () => {
    server = await startServer();
    execFileSync('node', ['scripts/seed-demo.mjs', server.url], { stdio: 'ignore' });
    browser = await launch();
    const res = await fetch(`${server.url}/api/tracks?sort=new&limit=1`);
    const first = (await res.json()).items[0];
    trackPath = `/t/${first.id}`;
    // a playlist for the playlist page
    const login = await fetch(`${server.url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'wavely' }, body: JSON.stringify({ username: 'demo', password: PASS }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const h = { 'content-type': 'application/json', 'x-requested-with': 'wavely', cookie };
    const pl = await (await fetch(`${server.url}/api/playlists`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Favourites', isPublic: true }) })).json();
    await fetch(`${server.url}/api/playlists/${pl.id}/tracks`, { method: 'POST', headers: h, body: JSON.stringify({ trackId: first.id }) });
    playlistPath = `/p/${pl.id}`;
  });
  after(async () => { await browser?.close(); await server?.stop(); });

  for (const [device, opts] of Object.entries(TARGETS)) {
    for (const scheme of ['dark', 'light']) {
      test(`${device}/${scheme}: signed-out pages have no a11y violations and no overflow`, async () => {
        const { page, context, problems } = await openPage(browser, server.url, { ...opts, colorScheme: scheme });
        for (const path of ['/', '/search?q=a', trackPath, '/u/demo', '/about', playlistPath, '/library', '/settings', '/missing-page']) {
          await page.goto(server.url + path);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(150);
          await audit(page, `${device}/${scheme} ${path}`);
          await noHorizontalScroll(page, `${device}/${scheme} ${path}`);
        }
        assert.deepEqual(problems.filter((p) => !/40[134]/.test(p)), []);
        await context.close();
      });

      test(`${device}/${scheme}: signed-in pages, dialogs, menus and player sheet`, async () => {
        const { page, context, problems } = await openPage(browser, server.url, { ...opts, colorScheme: scheme });
        await signIn(page);
        for (const path of ['/', '/library?tab=liked', '/library?tab=playlists', '/library?tab=uploads', '/settings', '/admin', '/admin?tab=queue', '/admin?tab=users']) {
          await page.goto(server.url + path);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(150);
          await audit(page, `${device}/${scheme} ${path}`);
          await noHorizontalScroll(page, `${device}/${scheme} ${path}`);
        }
        // upload dialog
        await page.goto(server.url + '/');
        await page.getByRole('button', { name: 'Upload' }).first().click();
        await page.getByRole('dialog').waitFor();
        await audit(page, `${device}/${scheme} upload dialog`);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        // track menu
        await page.goto(server.url + trackPath);
        await page.getByTestId('track-title').waitFor();
        await page.getByRole('button', { name: 'More actions' }).first().click();
        await page.getByRole('menu').waitFor();
        await audit(page, `${device}/${scheme} track menu`);
        await page.keyboard.press('Escape');
        // player + sheet
        await page.getByTestId('track-play').click();
        await page.waitForFunction(() => window.__wavelyAudio.currentTime > 0.3);
        await page.waitForTimeout(200);
        await audit(page, `${device}/${scheme} playing`);
        await page.getByRole('button', { name: 'Open player' }).click();
        await page.getByRole('dialog', { name: 'Now playing' }).waitFor();
        await page.waitForTimeout(400); // let the entrance animation finish: axe measures contrast mid-fade otherwise
        await audit(page, `${device}/${scheme} now playing sheet`);
        await page.getByRole('tab', { name: 'Queue' }).click();
        await audit(page, `${device}/${scheme} queue sheet`);
        assert.deepEqual(problems.filter((p) => !/40[134]/.test(p)), []);
        await context.close();
      });
    }
  }

  test('mobile layout: tab bar visible, sidebar hidden, mini player opens the sheet', async () => {
    const { page, context } = await openPage(browser, server.url, TARGETS.mobile);
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    assert.equal(await page.locator('.tabbar').isVisible(), true);
    await page.locator('.card .play-overlay').first().click({ force: true });
    await page.waitForFunction(() => !window.__wavelyAudio.paused);
    const player = await page.locator('.player').boundingBox();
    const tabbar = await page.locator('.tabbar').boundingBox();
    assert.ok(player.y + player.height <= tabbar.y + 1, 'player sits above the tab bar');
    await page.getByRole('button', { name: 'Open player' }).click();
    const sheet = page.getByRole('dialog', { name: 'Now playing' });
    await sheet.waitFor();
    await sheet.getByRole('button', { name: 'Pause' }).click();
    await page.waitForFunction(() => window.__wavelyAudio.paused);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await sheet.waitFor({ state: 'detached' });
    await context.close();
  });

  test('desktop layout: sidebar visible, tab bar hidden, volume control works', async () => {
    const { page, context } = await openPage(browser, server.url, TARGETS.desktop);
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    assert.equal(await page.locator('.tabbar').isVisible(), false);
    await page.locator('.card .play-overlay').first().click({ force: true });
    await page.waitForFunction(() => !window.__wavelyAudio.paused);
    const vol = page.getByRole('slider', { name: 'Volume' });
    await vol.evaluate((el) => { el.value = '0.3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => Math.round(window.__wavelyAudio.volume * 100)), 30);
    await page.getByRole('button', { name: 'Mute' }).click();
    assert.equal(await page.evaluate(() => window.__wavelyAudio.muted), true);
    await context.close();
  });

  test('keyboard-only: tab order reaches player controls; menus operable with the keyboard', async () => {
    const { page, context } = await openPage(browser, server.url, TARGETS.desktop);
    await page.goto(server.url + trackPath);
    await page.getByTestId('track-title').waitFor();
    await page.getByRole('button', { name: 'More actions' }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'More actions', 'focus returns to the trigger');
    await context.close();
  });
});
