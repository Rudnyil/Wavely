import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, launch, openPage, closeOpenContexts } from './helpers.js';
import { audio } from '../helpers.js';

const PASS = 'correct horse battery';
let server; let browser;

async function api(method, url, { body, cookie, form } = {}) {
  const headers = { 'x-requested-with': 'wavely', ...(cookie ? { cookie } : {}) };
  let payload = form;
  if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(server.url + url, { method, headers, body: payload });
  return { res, json: await res.json().catch(() => null), cookie: (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ') };
}

async function seedUser(username) {
  const r = await api('POST', '/api/auth/register', { body: { username, password: PASS } });
  return r.cookie;
}
async function seedTrack(cookie, title) {
  const form = new FormData();
  Object.entries({ title, genre: 'Test', prompt: 'test prompt', confirmAi: 'true', license: 'commercial' }).forEach(([k, v]) => form.append(k, v));
  form.append('audio', new Blob([audio.mp3()], { type: 'audio/mpeg' }), 'a.mp3');
  const r = await api('POST', '/api/tracks', { form, cookie });
  return r.json;
}
async function signIn(page, username) {
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Username').fill(username);
  await dlg.getByLabel('Password', { exact: true }).fill(PASS);
  await dlg.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).waitFor();
}

afterEach(closeOpenContexts);

describe('moderation, settings and server modes', () => {
  before(async () => { server = await startServer({ REQUIRE_APPROVAL: 'true' }); browser = await launch(); });
  after(async () => { await browser?.close(); await server?.stop(); });

  test('report from an anonymous visitor reaches the moderator, who removes the track', async () => {
    const admin = await seedUser('root');
    const author = await seedUser('author');
    const draft = await seedTrack(author, 'Borrowed Melody');
    assert.equal(draft.status, 'pending');
    await api('POST', `/api/admin/tracks/${draft.id}/status`, { cookie: admin, body: { status: 'published' } });

    const anon = await openPage(browser, `${server.url}/t/${draft.id}`);
    await anon.page.getByTestId('track-title').waitFor();
    await anon.page.getByRole('button', { name: 'More actions' }).first().click();
    await anon.page.getByRole('menuitem', { name: 'Report' }).click();
    const dlg = anon.page.getByRole('dialog');
    await dlg.getByLabel('Reason').selectOption('copyright');
    await dlg.getByLabel('Details').fill('This is a copy of my song');
    await dlg.getByLabel(/Your contact/).fill('rights@example.org');
    await dlg.getByRole('button', { name: 'Send report' }).click();
    await anon.page.getByText(/the report was sent/).waitFor();
    assert.deepEqual(anon.problems, []);
    await anon.context.close();

    const mod = await openPage(browser, server.url);
    await signIn(mod.page, 'root');
    await mod.page.getByRole('link', { name: 'Moderation' }).first().click();
    await mod.page.locator('.stat', { hasText: 'Open reports' }).locator('b').waitFor();
    assert.equal(await mod.page.locator('.stat', { hasText: 'Open reports' }).locator('b').textContent(), '1');
    const row = mod.page.locator('tr[data-report-id]');
    await row.getByText('Borrowed Melody').waitFor();
    await row.getByText('This is a copy of my song').waitFor();
    await row.getByText('rights@example.org').waitFor();
    await row.getByRole('button', { name: 'Remove track' }).click();
    await mod.page.getByText('No reports').waitFor();
    assert.equal((await api('GET', `/api/tracks/${draft.id}`)).res.status, 404);
    await mod.page.getByRole('tab', { name: 'Removed' }).click();
    await mod.page.getByText('Borrowed Melody').waitFor();
    await mod.page.getByRole('button', { name: 'Restore' }).click();
    await mod.page.getByText('No removed tracks').waitFor();
    assert.equal((await api('GET', `/api/tracks/${draft.id}`)).res.status, 200);
    assert.deepEqual(mod.problems, []);
    await mod.context.close();
  });

  test('review queue: a pending upload shows up and can be approved or rejected', async () => {
    const user = await seedUser('newbie');
    const t1 = await seedTrack(user, 'Needs Review');
    const t2 = await seedTrack(user, 'Bad Upload');
    const mod = await openPage(browser, server.url);
    await signIn(mod.page, 'root');
    await mod.page.goto(`${server.url}/admin?tab=queue`);
    await mod.page.locator('li', { hasText: 'Needs Review' }).waitFor();
    await mod.page.locator('li', { hasText: 'Bad Upload' }).getByRole('button', { name: 'Reject' }).click();
    await mod.page.locator('li', { hasText: 'Needs Review' }).getByRole('button', { name: 'Approve' }).click();
    await mod.page.getByText('Nothing is waiting for review').waitFor();
    assert.equal((await api('GET', `/api/tracks/${t1.id}`)).res.status, 200);
    assert.equal((await api('GET', `/api/tracks/${t2.id}`)).res.status, 404);
    // the author sees the status of their own pending uploads
    await mod.context.close();
  });

  test('user management: promote to moderator, disable account', async () => {
    const mod = await openPage(browser, server.url);
    await signIn(mod.page, 'root');
    await mod.page.goto(`${server.url}/admin?tab=users`);
    const row = mod.page.locator('tr[data-user=newbie]');
    await row.waitFor();
    await row.locator('select').selectOption('moderator');
    await mod.page.waitForFunction(async () => {
      const r = await fetch('/api/admin/users?q=newbie');
      return (await r.json()).items[0].role === 'moderator';
    });
    await row.getByRole('button', { name: 'Disable' }).click();
    await row.getByRole('button', { name: 'Enable' }).waitFor();
    const login = await api('POST', '/api/auth/login', { body: { username: 'newbie', password: PASS } });
    assert.equal(login.res.status, 401);
    assert.equal(await mod.page.locator('tr[data-user=root] select').isDisabled(), true, 'cannot change own role');
    assert.equal(await mod.page.locator('tr[data-user=root]').getByRole('button').count(), 0, 'cannot disable self');
    await mod.context.close();
  });

  test('non-moderators see an access-denied page', async () => {
    await seedUser('plain');
    const p = await openPage(browser, server.url);
    await signIn(p.page, 'plain');
    await p.page.goto(`${server.url}/admin`);
    await p.page.getByText('Only moderators can open this page').waitFor();
    assert.equal(await p.page.getByRole('link', { name: 'Moderation' }).count(), 0);
    await p.context.close();
  });

  test('settings: profile, password change, export, account deletion', async () => {
    await seedUser('settler');
    const p = await openPage(browser, server.url);
    await signIn(p.page, 'settler');
    await p.page.goto(`${server.url}/settings`);
    await p.page.getByLabel('Display name').fill('Settler Prime');
    await p.page.getByLabel('About you').fill('I make music with AI.');
    await p.page.getByRole('button', { name: 'Save' }).click();
    await p.page.getByText('Saved').waitFor();
    await p.page.goto(`${server.url}/u/settler`);
    await p.page.getByRole('heading', { name: 'Settler Prime' }).waitFor();
    await p.page.getByText('I make music with AI.').waitFor();

    await p.page.goto(`${server.url}/settings`);
    await p.page.getByLabel('Current password').fill(PASS);
    await p.page.getByLabel('New password').fill('a brand new password');
    await p.page.getByRole('button', { name: 'Change password' }).click();
    await p.page.getByText(/Password changed/).waitFor();
    assert.equal((await api('POST', '/api/auth/login', { body: { username: 'settler', password: 'a brand new password' } })).res.status, 200);

    const [download] = await Promise.all([p.page.waitForEvent('download'), p.page.getByRole('link', { name: 'Export data (JSON)' }).click()]);
    const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(data.user.username, 'settler');
    assert.equal(data.user.displayName, 'Settler Prime');

    await p.page.getByRole('button', { name: 'Delete account' }).click();
    const dlg = p.page.getByRole('dialog');
    await dlg.getByLabel('Password').fill('wrong wrong wrong');
    await dlg.getByRole('button', { name: 'Delete account' }).click();
    await dlg.getByText('The password is wrong.').waitFor();
    await dlg.getByLabel('Password').fill('a brand new password');
    await dlg.getByRole('button', { name: 'Delete account' }).click();
    await p.page.getByText('Your account was deleted').waitFor();
    assert.equal((await api('POST', '/api/auth/login', { body: { username: 'settler', password: 'a brand new password' } })).res.status, 401);
    assert.deepEqual(p.problems.filter((x) => !/40[13]|409/.test(x)), []);
    await p.context.close();
  });

  test('UI errors are shown in the current language', async () => {
    const p = await openPage(browser, server.url, { locale: 'uk-UA' });
    await p.page.getByRole('button', { name: 'Увійти' }).first().click();
    const dlg = p.page.getByRole('dialog');
    await dlg.getByLabel(/Ім’я користувача/).fill('root');
    await dlg.getByLabel('Пароль', { exact: true }).fill('wrongwrongwrong');
    await dlg.getByRole('button', { name: 'Увійти' }).click();
    await dlg.getByText('Неправильне ім’я користувача або пароль.').waitFor();
    await p.context.close();
  });
});

describe('registration modes in the UI', () => {
  test('invite-only: code field is required and enforced', async () => {
    const s = await startServer({ REGISTRATION: 'invite', INVITE_CODE: 'open-sesame' });
    const b = await launch();
    try {
      const first = await fetch(`${s.url}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'wavely' }, body: JSON.stringify({ username: 'owner', password: PASS }) });
      assert.equal(first.status, 201);
      const p = await openPage(b, s.url);
      await p.page.getByRole('button', { name: 'Sign in' }).first().click();
      const dlg = p.page.getByRole('dialog');
      await dlg.getByRole('button', { name: /No account yet/ }).click();
      await dlg.getByLabel('Username').fill('guest');
      await dlg.getByLabel('Password', { exact: true }).fill(PASS);
      await dlg.getByLabel('Invite code').fill('wrong');
      await dlg.getByRole('button', { name: 'Create account' }).click();
      await dlg.getByText('The invite code is wrong.').waitFor();
      await dlg.getByLabel('Invite code').fill('open-sesame');
      await dlg.getByRole('button', { name: 'Create account' }).click();
      await p.page.getByRole('button', { name: 'Account', exact: true }).waitFor();
      await p.context.close();
    } finally { await b.close(); await s.stop(); }
  });

  test('closed registration hides the create-account path; admins-only uploads hide the upload button', async () => {
    const s = await startServer({ REGISTRATION: 'closed', UPLOAD_POLICY: 'admins' });
    const b = await launch();
    try {
      await fetch(`${s.url}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'wavely' }, body: JSON.stringify({ username: 'owner', password: PASS }) });
      const p = await openPage(b, s.url);
      await p.page.getByRole('button', { name: 'Sign in' }).first().click();
      const dlg = p.page.getByRole('dialog');
      await dlg.getByText('Registration is closed on this server.').waitFor();
      assert.equal(await dlg.getByRole('button', { name: /No account yet/ }).count(), 0);
      await p.context.close();
    } finally { await b.close(); await s.stop(); }
  });
});
