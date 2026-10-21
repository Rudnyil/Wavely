import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AxeBuilder } from '@axe-core/playwright';
import { startServer, launch, openPage } from './helpers.js';

let server; let browser;
before(async () => {
  server = await startServer({ CONTACT_EMAIL: 'abuse@example.org', LEGAL_URL: 'https://example.org/terms' });
  browser = await launch();
});
after(async () => { await browser?.close(); await server?.stop(); });

describe('About page contact block', () => {
  for (const scheme of ['dark', 'light']) {
    test(`${scheme}: shows the operator contact and legal link, with no accessibility violations`, async () => {
      const { page, context, problems } = await openPage(browser, `${server.url}/about`, { colorScheme: scheme });
      const mail = page.getByRole('link', { name: 'abuse@example.org' });
      await mail.waitFor();
      assert.equal(await mail.getAttribute('href'), 'mailto:abuse@example.org');
      const legal = page.getByRole('link', { name: 'Terms and privacy policy of this service' });
      assert.equal(await legal.getAttribute('href'), 'https://example.org/terms');
      assert.match(await legal.getAttribute('rel'), /noopener/);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), []);
      assert.deepEqual(problems, []);
      await context.close();
    });
  }

  test('without CONTACT_EMAIL and LEGAL_URL the block is not shown', async () => {
    const plain = await startServer();
    try {
      const { page, context } = await openPage(browser, `${plain.url}/about`);
      await page.getByRole('heading', { name: 'Reporting and takedown' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Contact and legal' }).count(), 0);
      await context.close();
    } finally { await plain.stop(); }
  });
});
