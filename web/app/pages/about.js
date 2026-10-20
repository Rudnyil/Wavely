import { html } from '../lib.js';
import { t, useLang } from '../i18n.js';
import { useSession } from '../session.js';
import { usePageTitle } from './util.js';

export function AboutPage() {
  useLang();
  usePageTitle(t('about.title'));
  const { config } = useSession();
  const block = (key) => html`<section class="panel" style="margin-top:16px"><h2 style="margin-bottom:8px">${t(`about.${key}.title`)}</h2>
    ${[1, 2, 3].map((n) => (t(`about.${key}.p${n}`) !== `about.${key}.p${n}` ? html`<p class="muted" style="margin-top:8px">${t(`about.${key}.p${n}`)}</p>` : null))}</section>`;
  return html`<div class="page" style="max-width:820px">
    <h1>${t('about.title')}</h1>
    <p class="muted" style="margin-top:10px">${t('about.intro', { name: config.name })}</p>
    ${block('rules')}${block('rights')}${block('report')}${block('privacy')}${block('oss')}
    <p class="faint" style="margin-top:16px">${config.name} · v${config.version}</p>
  </div>`;
}
