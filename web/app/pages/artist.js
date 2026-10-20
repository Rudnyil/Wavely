import { html, Icon, api } from '../lib.js';
import { t, tn, useLang } from '../i18n.js';
import { useAsync, Spinner, Empty } from '../components/common.js';
import { TrackList } from '../components/tracks.js';
import { playQueue } from '../player.js';
import { usePageTitle } from './util.js';

export function ArtistPage({ username }) {
  useLang();
  const artist = useAsync(() => api(`/artists/${encodeURIComponent(username)}`), [username]);
  const tracks = useAsync(() => api(`/tracks?artist=${encodeURIComponent(username)}&sort=new&limit=100`), [username]);
  const lists = useAsync(() => api(`/users/${encodeURIComponent(username)}/playlists`), [username]);
  usePageTitle(artist.data?.displayName);
  if (artist.loading) return html`<${Spinner} />`;
  if (artist.error) return html`<div class="page"><${Empty} icon="user" title=${t('artist.notFound')}><a class="btn" href="/">${t('nav.home')}</a><//></div>`;
  const a = artist.data;
  const items = tracks.data?.items || [];
  return html`<div class="page">
    <div class="eyebrow">${t('artist.eyebrow')}</div>
    <h1 style="margin:6px 0 8px">${a.displayName}</h1>
    <div class="meta-line"><span>@${a.username}</span><span>${tn('count.tracks', a.tracks)}</span><span>${tn('count.plays', a.plays)}</span></div>
    ${a.bio ? html`<p class="muted" style="margin-top:12px;max-width:70ch;white-space:pre-wrap">${a.bio}</p>` : null}
    ${items.length ? html`<div style="margin-top:18px"><button class="btn primary" onClick=${() => playQueue(items, 0)}><${Icon} name="play" />${t('player.play')}</button></div>` : null}
    <section class="section"><div class="section-head"><h2>${t('artist.tracks')}</h2></div>
      ${tracks.loading ? html`<${Spinner} />` : items.length ? html`<${TrackList} tracks=${items} />` : html`<${Empty} title=${t('artist.noTracks')} />`}</section>
    ${lists.data?.items.length ? html`<section class="section"><div class="section-head"><h2>${t('library.playlists')}</h2></div>
      <ul class="stack" style="gap:6px">${lists.data.items.map((p) => html`<li key=${p.id}><a class="btn" style="width:100%;justify-content:space-between" href=${`/p/${p.id}`}><span class="clamp">${p.name}</span><span class="faint">${tn('count.tracks', p.tracks)}</span></a></li>`)}</ul></section>` : null}
  </div>`;
}
