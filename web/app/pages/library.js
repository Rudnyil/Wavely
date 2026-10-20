import { html, Icon, api } from '../lib.js';
import { t, tn, useLang, errorText } from '../i18n.js';
import { useAsync, Spinner, Empty, Failed, MenuButton } from '../components/common.js';
import { TrackList } from '../components/tracks.js';
import { useSession, openDialog, useDataVersion, invalidate, useOverrides, withOverride } from '../session.js';
import { navigate, useRoute } from '../router.js';
import { playQueue } from '../player.js';
import { toast } from '../toast.js';
import { usePageTitle } from './util.js';

// Tracks unliked while this tab is open disappear immediately.
const likedItems = (data) => data.items.filter((x) => withOverride(x).liked !== false);

function SignInPrompt() {
  return html`<div class="page"><${Empty} icon="library" title=${t('library.signIn')}>
    <button class="btn primary" onClick=${() => openDialog('auth')}>${t('auth.signIn')}</button><//></div>`;
}

export function LibraryPage() {
  useLang();
  usePageTitle(t('nav.library'));
  const { user, config } = useSession();
  const { search } = useRoute();
  const version = useDataVersion();
  useOverrides();
  const tab = ['liked', 'playlists', 'uploads'].includes(new URLSearchParams(search).get('tab')) ? new URLSearchParams(search).get('tab') : 'liked';
  const liked = useAsync(() => (user ? api('/tracks?liked=1&limit=100') : Promise.resolve(null)), [user?.id, version]);
  const lists = useAsync(() => (user ? api('/playlists') : Promise.resolve(null)), [user?.id, version]);
  const mine = useAsync(() => (user ? api('/tracks/mine') : Promise.resolve(null)), [user?.id, version]);
  if (!user) return html`<${SignInPrompt} />`;
  const go = (name) => navigate(`/library?tab=${name}`, { replace: true });

  return html`<div class="page">
    <div class="row wrap" style="margin-bottom:12px"><h1 class="grow">${t('nav.library')}</h1>
      ${tab === 'playlists' ? html`<button class="btn primary" onClick=${() => openDialog('playlist-form', { onSaved: (pl) => navigate(`/p/${pl.id}`) })}><${Icon} name="plus" />${t('playlist.new')}</button>` : null}
      ${tab === 'uploads' && config.canUpload ? html`<button class="btn primary" onClick=${() => openDialog('upload')}><${Icon} name="upload" />${t('nav.upload')}</button>` : null}</div>
    <div class="tabs" role="tablist">
      ${['liked', 'playlists', 'uploads'].map((n) => html`<button role="tab" aria-selected=${tab === n} onClick=${() => go(n)}>${t(`library.${n}`)}</button>`)}
    </div>
    ${tab === 'liked' ? (liked.loading ? html`<${Spinner} />` : liked.error ? html`<${Failed} onRetry=${liked.reload} />` : (likedItems(liked.data)).length ? html`
      <div style="margin-bottom:10px"><button class="btn" onClick=${() => playQueue(likedItems(liked.data), 0)}><${Icon} name="play" />${t('player.playAll')}</button></div>
      <${TrackList} tracks=${likedItems(liked.data)} />` : html`<${Empty} icon="heart" title=${t('library.noLiked')}>${t('library.noLikedHint')}<//>`) : null}
    ${tab === 'playlists' ? (lists.loading ? html`<${Spinner} />` : lists.error ? html`<${Failed} onRetry=${lists.reload} />` : lists.data.items.length ? html`
      <ul class="stack" style="gap:8px">${lists.data.items.map((p) => html`<li key=${p.id}><a class="btn" style="width:100%;justify-content:space-between;height:52px" href=${`/p/${p.id}`}>
        <span class="clamp"><strong>${p.name}</strong> ${p.isPublic ? '' : html`<span class="badge" style="margin-left:6px">${t('playlist.private')}</span>`}</span><span class="faint">${tn('count.tracks', p.tracks)}</span></a></li>`)}</ul>`
    : html`<${Empty} icon="library" title=${t('library.noPlaylists')}>${t('library.noPlaylistsHint')}<//>`) : null}
    ${tab === 'uploads' ? (mine.loading ? html`<${Spinner} />` : mine.error ? html`<${Failed} onRetry=${mine.reload} />` : mine.data.items.length ? html`<${TrackList} tracks=${mine.data.items} />`
    : html`<${Empty} icon="upload" title=${t('library.noUploads')}>${config.canUpload ? t('library.noUploadsHint') : t('library.uploadsRestricted')}<//>`) : null}
  </div>`;
}

export function PlaylistPage({ id }) {
  useLang();
  const { user } = useSession();
  const version = useDataVersion();
  const pl = useAsync(() => api(`/playlists/${id}`), [id, version]);
  usePageTitle(pl.data?.name);
  if (pl.loading && !pl.data) return html`<${Spinner} />`;
  if (pl.error) return html`<div class="page"><${Empty} icon="library" title=${t('playlist.notFound')}><a class="btn" href="/">${t('nav.home')}</a><//></div>`;
  const p = pl.data;
  const own = user && p.owner.username === user.username;

  const act = async (fn) => { try { await fn(); invalidate(); } catch (e) { toast(errorText(e), 'error'); } };
  const move = (i, d) => act(() => {
    const ids = p.items.map((x) => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return Promise.resolve();
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return api(`/playlists/${p.id}/order`, { method: 'PUT', body: { trackIds: ids } });
  });
  const remove = (track) => act(() => api(`/playlists/${p.id}/tracks/${track.id}`, { method: 'DELETE' }));
  const del = () => openDialog('confirm', {
    title: t('playlist.delete'), message: t('playlist.deleteConfirm', { name: p.name }), confirmLabel: t('playlist.delete'), danger: true,
    onConfirm: async () => { await api(`/playlists/${p.id}`, { method: 'DELETE' }); toast(t('playlist.deleted')); navigate('/library?tab=playlists'); },
  });

  return html`<div class="page">
    <div class="eyebrow">${t('playlist.eyebrow')}${p.isPublic ? '' : html` · ${t('playlist.private')}`}</div>
    <h1 style="margin:6px 0 8px" data-testid="playlist-name">${p.name}</h1>
    <div class="meta-line"><a href=${`/u/${p.owner.username}`}>${p.owner.displayName}</a><span>${tn('count.tracks', p.tracks)}</span></div>
    ${p.description ? html`<p class="muted" style="margin-top:10px;max-width:70ch">${p.description}</p>` : null}
    <div class="row wrap" style="margin-top:18px">
      ${p.items.length ? html`<button class="btn primary" onClick=${() => playQueue(p.items, 0)}><${Icon} name="play" />${t('player.playAll')}</button>` : null}
      ${own ? html`<button class="btn" onClick=${() => openDialog('playlist-form', { playlist: p, onSaved: () => invalidate() })}><${Icon} name="edit" />${t('track.edit')}</button>
        <button class="btn danger" onClick=${del}><${Icon} name="trash" />${t('playlist.delete')}</button>` : null}
    </div>
    <div class="section">${p.items.length ? html`<ul class="tracklist">${p.items.map((tr, i) => html`
      <li key=${tr.id} class="row" style="gap:0">
        <div class="grow" style="min-width:0"><ul class="tracklist"><${PlaylistRow} track=${tr} index=${i} all=${p.items} onRemove=${own ? () => remove(tr) : undefined} /></ul></div>
        ${own ? html`<div class="row" style="gap:0">
          <button class="iconbtn sm" aria-label=${t('playlist.moveUp')} disabled=${i === 0} onClick=${() => move(i, -1)}><${Icon} name="arrowup" /></button>
          <button class="iconbtn sm" aria-label=${t('playlist.moveDown')} disabled=${i === p.items.length - 1} onClick=${() => move(i, 1)}><${Icon} name="arrowdown" /></button></div>` : null}
      </li>`)}</ul>` : html`<${Empty} icon="music" title=${t('playlist.empty')}>${t('playlist.emptyHint')}<//>`}</div>
  </div>`;
}

import { TrackRow } from '../components/tracks.js';
const PlaylistRow = ({ track, index, all, onRemove }) => html`<${TrackRow} track=${track} index=${index} context=${all} onRemove=${onRemove} />`;
