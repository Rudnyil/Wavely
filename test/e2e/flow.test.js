import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openPage } from './helpers.js';
import { audio, image } from '../helpers.js';

let server; let browser; let page; let problems; let context;

const PASS = 'correct horse battery';

async function signUp(p, username, { first = false } = {}) {
  await p.getByRole('button', { name: first ? 'Create account' : 'Sign in' }).first().click();
  const dlg = p.getByRole('dialog');
  if (!first) await dlg.getByRole('button', { name: /No account yet/ }).click();
  await dlg.getByLabel('Username').fill(username);
  await dlg.getByLabel('Password', { exact: true }).fill(PASS);
  await dlg.getByRole('button', { name: 'Create account' }).click();
  await p.getByRole('button', { name: 'Account', exact: true }).waitFor();
}

async function uploadTrack(p, { title, genre = 'Synthwave', prompt = 'dreamy synthwave with arpeggios', buffer = audio.medium(), cover = false, name = 'song.mp3' }) {
  await p.getByRole('button', { name: 'Upload' }).first().click();
  const dlg = p.getByRole('dialog');
  await dlg.getByTestId('audio-input').setInputFiles({ name, mimeType: 'audio/mpeg', buffer });
  await dlg.getByLabel('Title').fill(title);
  await dlg.getByLabel('Genre').fill(genre);
  await dlg.getByLabel('Generator / model').fill('Suno v4');
  await dlg.getByLabel(/Prompt or description/).fill(prompt);
  if (cover) await dlg.getByTestId('cover-input').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: image.png() });
  await dlg.getByTestId('confirm-ai').check();
  await dlg.getByRole('button', { name: 'Publish' }).click();
  await p.waitForFunction((t) => document.querySelector('[data-testid=track-title]')?.textContent === t, title);
}

const audioState = (p) => p.evaluate(() => {
  const a = window.__wavelyAudio;
  return { paused: a.paused, time: a.currentTime, duration: a.duration, src: a.src };
});

describe('main user flow (desktop)', () => {
  before(async () => {
    server = await startServer();
    browser = await launch();
    ({ page, problems, context } = await openPage(browser, server.url));
  });
  after(async () => { await context?.close(); await browser?.close(); await server?.stop(); });

  test('first visitor creates the account and becomes admin', async () => {
    await page.getByRole('heading', { name: 'Streaming for AI-generated music' }).waitFor();
    await signUp(page, 'alice', { first: true });
    await page.getByRole('link', { name: 'Moderation' }).waitFor();
    assert.deepEqual(problems, []);
  });

  test('upload a track with a cover through the UI', async () => {
    await uploadTrack(page, { title: 'Neon Rain', cover: true });
    assert.equal(await page.getByTestId('track-title').textContent(), 'Neon Rain');
    assert.match(page.url(), /\/t\/[\w-]+$/);
    await page.getByTestId('track-prompt').waitFor();
    assert.match(await page.getByTestId('track-prompt').textContent(), /dreamy synthwave/);
    const img = page.locator('.detail-head .cover img');
    await img.waitFor();
    const natural = await img.evaluate((i) => i.complete && i.naturalWidth);
    assert.equal(natural, 640);
  });

  test('play, pause, seek and keyboard shortcut', async () => {
    await page.getByTestId('track-play').click();
    await page.waitForFunction(() => window.__wavelyAudio.currentTime > 0.6);
    let st = await audioState(page);
    assert.equal(st.paused, false);
    assert.equal(page.url().includes('/t/'), true);
    assert.equal(await page.getByTestId('player-title').textContent(), 'Neon Rain');

    await page.getByRole('button', { name: 'Pause' }).first().click();
    st = await audioState(page);
    assert.equal(st.paused, true);

    // seek with the player's range input
    const seek = page.locator('.player input[type=range]').first();
    await seek.focus();
    await seek.evaluate((el) => { el.value = '12'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => Math.abs(window.__wavelyAudio.currentTime - 12) < 0.6);

    // Space toggles when nothing interactive has focus
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !window.__wavelyAudio.paused);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__wavelyAudio.paused);

    // waveform click seeks
    const wave = page.locator('.wave');
    const box = await wave.boundingBox();
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.waitForFunction(() => Math.abs(window.__wavelyAudio.currentTime - 5) < 1.2);
    assert.deepEqual(problems, []);
  });

  test('play count is registered after listening and shown', async () => {
    await page.getByTestId('track-play').click();
    // medium track is 20 s: threshold is min(30, 10) = 10 s of listening
    await page.evaluate(() => { window.__wavelyAudio.currentTime = 1; });
    await page.waitForFunction(() => window.__wavelyAudio.currentTime > 11.5, null, { timeout: 30000 });
    await page.waitForFunction(async () => {
      const id = location.pathname.split('/').pop();
      const r = await fetch(`/api/tracks/${id}`);
      return (await r.json()).plays >= 1;
    }, null, { timeout: 10000 });
    await page.getByRole('button', { name: 'Pause' }).first().click();
  });

  test('like toggles and shows up in the library', async () => {
    const like = page.locator('.detail-head').getByRole('button', { name: 'Like' });
    await like.click();
    await page.locator('.detail-head').getByRole('button', { name: 'Remove like' }).waitFor();
    await page.locator('.meta-line').getByText('1 like', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Library' }).first().click();
    await page.getByRole('heading', { name: 'Neon Rain' }).or(page.locator('.track .t-title', { hasText: 'Neon Rain' })).first().waitFor();
    await page.locator('.track').first().getByRole('button', { name: 'Remove like' }).click();
    await page.getByText('No liked tracks').waitFor();
  });

  test('playlists: create from track menu, reorder, remove, delete', async () => {
    await uploadTrack(page, { title: 'Second Song', genre: 'Lo-fi', prompt: 'lofi beat', buffer: audio.mp3(), name: 'second.mp3' });
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('New playlist name').fill('Night drive');
    await dlg.getByRole('button', { name: 'Create' }).click();
    await page.getByText('Added to “Night drive”').waitFor();

    await page.goto(`${server.url}/`);
    await page.locator('.card', { hasText: 'Neon Rain' }).getByRole('link', { name: 'Neon Rain' }).first().click();
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Add to playlist' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Night drive/ }).click();
    await page.getByText('Added to “Night drive”').first().waitFor();

    await page.getByRole('link', { name: 'Library' }).first().click();
    await page.getByRole('tab', { name: 'Playlists' }).click();
    await page.getByRole('link', { name: /Night drive/ }).click();
    await page.getByTestId('playlist-name').waitFor();
    const titles = () => page.locator('.tracklist .t-title').allTextContents();
    assert.deepEqual(await titles(), ['Second Song', 'Neon Rain']);
    await page.getByRole('button', { name: 'Move down' }).first().click();
    await page.waitForFunction(() => document.querySelector('.tracklist .t-title')?.textContent === 'Neon Rain');
    assert.deepEqual(await titles(), ['Neon Rain', 'Second Song']);

    await page.locator('.track').first().getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove from playlist' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.tracklist .t-title').length === 1);

    await page.getByRole('button', { name: 'Delete playlist' }).click();
    await page.getByTestId('confirm-yes').click();
    await page.getByText('Playlist deleted').waitFor();
    assert.deepEqual(problems, []);
  });

  test('search: text, prefix, genre filter, no results', async () => {
    await page.goto(`${server.url}/`);
    const box = page.getByRole('searchbox');
    await box.fill('neo');
    await page.waitForURL(/\/search\?q=neo/);
    await page.locator('.track .t-title', { hasText: 'Neon Rain' }).waitFor();
    assert.equal(await page.locator('.track').count(), 1);
    await box.fill('zzzz nothing');
    await page.getByText('Nothing found').waitFor();
    await box.fill('');
    await page.waitForURL((u) => u.pathname === '/search');
    await page.locator('#genre-filter').selectOption('Lo-fi');
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 1);
    assert.equal(await page.locator('.track .t-title').first().textContent(), 'Second Song');
    await page.getByRole('button', { name: 'A–Z' }).click();
    await page.waitForURL(/sort=title/);
  });

  test('queue: play next / add to queue and now-playing sheet', async () => {
    await page.goto(`${server.url}/search`);
    await page.locator('.track').first().getByRole('button', { name: /^Play:/ }).click();
    await page.waitForFunction(() => !window.__wavelyAudio.paused);
    await page.getByRole('button', { name: 'Queue' }).click();
    const sheet = page.getByRole('dialog', { name: 'Now playing' });
    await sheet.waitFor();
    assert.ok((await sheet.locator('.queue-item').count()) >= 2);
    await sheet.getByRole('tab', { name: 'Now playing' }).click();
    await sheet.locator('.wave').waitFor();
    await sheet.getByRole('button', { name: 'Next' }).click();
    await page.waitForFunction(() => window.__wavelyAudio.src.length > 0);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
  });

  test('language switch to Ukrainian uses correct plural forms and persists after reload', async () => {
    await page.goto(`${server.url}/settings`);
    await page.getByRole('button', { name: 'Українська' }).click();
    await page.getByRole('heading', { name: 'Налаштування' }).waitFor();
    await page.goto(`${server.url}/u/alice`);
    await page.getByText(/^2 треки$/).waitFor();
    await page.reload();
    await page.getByText(/^2 треки$/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'uk');
    await page.goto(`${server.url}/settings`);
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByRole('heading', { name: 'Settings' }).first().waitFor();
  });

  test('edit a track and delete it', async () => {
    await page.goto(`${server.url}/search?q=second`);
    await page.locator('.track .t-title', { hasText: 'Second Song' }).click();
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Title').fill('Second Song (remix)');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=track-title]')?.textContent === 'Second Song (remix)');
    await page.getByRole('button', { name: 'More actions' }).first().click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForURL(`${server.url}/`);
    await page.goto(`${server.url}/search?q=remix`);
    await page.getByText('Nothing found').waitFor();
  });

  test('no console errors or failed requests during the whole flow', async () => {
    assert.deepEqual(problems, []);
  });
});
