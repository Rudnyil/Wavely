import { html, Icon, api } from '../lib.js';
import { t, useLang } from '../i18n.js';
import { useAsync, Spinner, Empty, Failed } from '../components/common.js';
import { TrackGrid } from '../components/tracks.js';
import { useSession, openDialog } from '../session.js';
import { usePageTitle } from './util.js';

export function HomePage() {
  useLang();
  usePageTitle('');
  const { config, user } = useSession();
  const newest = useAsync(() => api('/tracks?sort=new&limit=12'), []);
  const popular = useAsync(() => api('/tracks?sort=popular&limit=12'), []);
  const genres = useAsync(() => api('/genres'), []);
  const total = newest.data?.total;

  return html`<div class="page">
    <section class="hero">
      <h1>${t('home.title')}</h1>
      <p>${t('home.subtitle')}</p>
      <div class="row wrap">
        ${user
    ? (config.canUpload ? html`<button class="btn primary" onClick=${() => openDialog('upload')}><${Icon} name="upload" />${t('nav.upload')}</button>` : null)
    : html`<button class="btn primary" onClick=${() => openDialog('auth')}>${config.needsSetup ? t('auth.createAccount') : t('auth.signIn')}</button>`}
        <a class="btn" href="/about">${t('home.rules')}</a>
      </div>
      ${config.needsSetup ? html`<p class="notice" style="margin-top:16px">${t('auth.firstUser')}</p>` : null}
    </section>

    ${genres.data?.items.length ? html`<section class="section" aria-labelledby="h-genres">
      <div class="section-head"><h2 id="h-genres">${t('home.genres')}</h2></div>
      <div class="chips">${genres.data.items.slice(0, 16).map((g) => html`<a class="chip" key=${g.name} href=${`/search?genre=${encodeURIComponent(g.name)}`}>${g.name}</a>`)}</div>
    </section>` : null}

    ${newest.loading ? html`<${Spinner} />` : newest.error ? html`<${Failed} onRetry=${newest.reload} />` : total === 0 ? html`
      <${Empty} title=${t('home.empty')}>${config.canUpload ? t('home.emptyUpload') : t('home.emptySignIn')}<//>` : html`
      <section class="section" aria-labelledby="h-new">
        <div class="section-head"><h2 id="h-new">${t('home.new')}</h2><a href="/search?sort=new">${t('common.showAll')}</a></div>
        <${TrackGrid} tracks=${newest.data.items} />
      </section>
      ${popular.data?.items.some((x) => x.plays > 0) ? html`<section class="section" aria-labelledby="h-pop">
        <div class="section-head"><h2 id="h-pop">${t('home.popular')}</h2><a href="/search?sort=popular">${t('common.showAll')}</a></div>
        <${TrackGrid} tracks=${popular.data.items} />
      </section>` : null}`}
  </div>`;
}
