import { html, api } from '../lib.js';
import { t, tn, useLang } from '../i18n.js';
import { useAsync, Spinner, Empty } from '../components/common.js';
import { TrackList } from '../components/tracks.js';
import { navigate, useRoute } from '../router.js';
import { usePageTitle } from './util.js';
import { useState, useEffect } from 'preact/hooks';

const SORTS = ['new', 'popular', 'liked', 'title'];
const PAGE = 30;

export function SearchPage() {
  useLang();
  const { search } = useRoute();
  const params = new URLSearchParams(search);
  const q = params.get('q') || '';
  const genre = params.get('genre') || '';
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : q ? 'new' : 'new';
  usePageTitle(q || genre || t('nav.search'));

  const [extra, setExtra] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => setExtra([]), [q, genre, sort]);

  const query = (offset) => `/tracks?${new URLSearchParams({ q, genre, sort, limit: PAGE, offset })}`;
  const first = useAsync(() => api(query(0)), [q, genre, sort]);
  const artists = useAsync(() => (q ? api(`/artists?q=${encodeURIComponent(q)}&limit=8`) : Promise.resolve({ items: [] })), [q]);
  const genres = useAsync(() => api('/genres'), []);

  const items = [...(first.data?.items || []), ...extra];
  const total = first.data?.total || 0;

  const setParam = (key, value) => {
    const p = new URLSearchParams(search);
    if (value) p.set(key, value); else p.delete(key);
    navigate(`/search?${p}`, { replace: true });
  };
  const more = async () => {
    setLoadingMore(true);
    try { const r = await api(query(items.length)); setExtra((e) => [...e, ...r.items]); } finally { setLoadingMore(false); }
  };

  return html`<div class="page">
    <h1>${q ? t('search.resultsFor', { q }) : genre ? genre : t('search.browse')}</h1>
    <div class="row wrap" style="margin:16px 0 20px">
      <div class="chips" role="group" aria-label=${t('search.sort')}>
        ${SORTS.map((s) => html`<button type="button" class="chip" aria-pressed=${sort === s} onClick=${() => setParam('sort', s)}>${t(`sort.${s}`)}</button>`)}
      </div>
      <span class="grow"></span>
      <label class="sr-only" for="genre-filter">${t('search.genre')}</label>
      <select id="genre-filter" class="select" style="width:auto;min-width:160px" value=${genre} onChange=${(e) => setParam('genre', e.target.value)}>
        <option value="">${t('search.allGenres')}</option>
        ${(genres.data?.items || []).map((g) => html`<option value=${g.name} selected=${g.name.toLowerCase() === genre.toLowerCase()}>${g.name}</option>`)}
        ${genre && !(genres.data?.items || []).some((g) => g.name.toLowerCase() === genre.toLowerCase()) ? html`<option value=${genre} selected>${genre}</option>` : null}
      </select>
    </div>

    ${artists.data?.items.length ? html`<section aria-labelledby="h-artists" style="margin-bottom:24px">
      <h2 id="h-artists" style="margin-bottom:10px">${t('search.artists')}</h2>
      <div class="chips">${artists.data.items.map((a) => html`<a class="chip" key=${a.username} href=${`/u/${a.username}`}>${a.displayName} <span class="faint" style="margin-left:6px">${tn('count.tracks', a.tracks)}</span></a>`)}</div>
    </section>` : null}

    ${first.loading ? html`<${Spinner} />` : first.error ? html`<${Empty} title=${t('err.generic')} />` : items.length === 0
    ? html`<${Empty} icon="search" title=${t('search.none')}>${t('search.noneHint')}<//>`
    : html`<p class="faint" style="margin-bottom:8px" role="status">${tn('count.results', total)}</p>
        <${TrackList} tracks=${items} />
        ${items.length < total ? html`<div style="text-align:center;margin-top:16px"><button class="btn" disabled=${loadingMore} onClick=${more}>${t('common.loadMore')}</button></div>` : null}`}
  </div>`;
}
