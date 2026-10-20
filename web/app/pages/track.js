import { html, Icon, api, fmtTime, fmtDate, fmtNumber } from '../lib.js';
import { t, tn, useLang, getLang } from '../i18n.js';
import { useAsync, Spinner, Empty, Cover, MenuButton } from '../components/common.js';
import { LikeButton, TrackList, trackMenuItems, shareTrack } from '../components/tracks.js';
import { Waveform } from '../components/waveform.js';
import { playTrack, toggle, playerStore } from '../player.js';
import { useStore } from '../lib.js';
import { useSession, withOverride, useOverrides, useDataVersion } from '../session.js';
import { navigate } from '../router.js';
import { usePageTitle } from './util.js';
import { useState } from 'preact/hooks';

export function TrackPage({ id }) {
  useLang();
  useOverrides();
  const { user } = useSession();
  const version = useDataVersion();
  const detail = useAsync(() => api(`/tracks/${id}`), [id, version]);
  const more = useAsync(() => (detail.data ? api(`/tracks?artist=${detail.data.artist.username}&limit=8`) : Promise.resolve(null)), [detail.data?.artist.username]);
  const playing = useStore(playerStore, (s) => (s.queue[s.index]?.id === id ? (s.playing ? 'playing' : 'paused') : 'none'));
  const [showLyrics, setShowLyrics] = useState(false);
  usePageTitle(detail.data?.title);

  if (detail.loading && !detail.data) return html`<${Spinner} />`;
  if (detail.error) return html`<div class="page"><${Empty} icon="music" title=${t('track.notFound')}><a class="btn" href="/">${t('nav.home')}</a><//></div>`;

  const track = withOverride(detail.data);
  if (track.deleted) { navigate('/', { replace: true }); return null; }
  const lang = getLang();
  const state = playing;
  const onPlay = () => (state === 'none' ? playTrack(track, [track]) : toggle());
  const items = trackMenuItems(track, user);
  const others = (more.data?.items || []).filter((x) => x.id !== id);

  return html`<div class="page">
    <div class="detail-head">
      <${Cover} track=${track} lg />
      <div class="meta">
        <span class="eyebrow">${t('track.eyebrow')}${track.status !== 'published' ? html` · <span class=${`badge ${track.status === 'pending' ? 'warn' : 'danger'}`}>${t(`status.${track.status}`)}</span>` : ''}</span>
        <h1 data-testid="track-title">${track.title}</h1>
        <div class="meta-line">
          <a href=${`/u/${track.artist.username}`} style="color:var(--text);font-weight:600">${track.artist.displayName}</a>
          <span>${fmtTime(track.duration)}</span>
          <span>${tn('count.plays', track.plays)}</span>
          <span>${tn('count.likes', track.likes)}</span>
          <span>${fmtDate(track.createdAt, lang)}</span>
        </div>
        <div class="row wrap" style="margin-top:6px">
          <button type="button" class="playbtn" aria-label=${state === 'playing' ? t('player.pause') : t('player.play')} onClick=${onPlay} data-testid="track-play"><${Icon} name=${state === 'playing' ? 'pause' : 'play'} /></button>
          <${LikeButton} track=${track} />
          <button type="button" class="iconbtn" aria-label=${t('track.share')} onClick=${() => shareTrack(track)}><${Icon} name="share" /></button>
          <${MenuButton} label=${t('common.more')} small=${false} items=${items} />
        </div>
      </div>
    </div>

    <div class="section"><${Waveform} peaks=${track.peaks} duration=${track.duration} active=${state !== 'none'} /></div>

    <div class="section row wrap" style="align-items:stretch">
      <div class="panel grow" style="min-width:260px">
        <h3>${t('track.about')}</h3>
        <dl class="kv" style="margin-top:12px">
          ${track.genre ? html`<dt>${t('upload.genre')}</dt><dd><a href=${`/search?genre=${encodeURIComponent(track.genre)}`}>${track.genre}</a></dd>` : null}
          ${track.model ? html`<dt>${t('upload.model')}</dt><dd>${track.model}</dd>` : null}
          <dt>${t('upload.license')}</dt><dd>${t(`license.${track.license}`)}</dd>
        </dl>
      </div>
      <div class="panel grow" style="min-width:260px;flex:2">
        <h3>${t('track.prompt')}</h3>
        <pre data-testid="track-prompt">${track.prompt}</pre>
      </div>
    </div>

    ${track.lyrics ? html`<div class="section panel">
      <div class="row"><h3 class="grow">${t('upload.lyrics')}</h3>
        <button type="button" class="btn sm" aria-expanded=${showLyrics} onClick=${() => setShowLyrics(!showLyrics)}>${showLyrics ? t('common.hide') : t('common.show')}</button></div>
      ${showLyrics ? html`<pre>${track.lyrics}</pre>` : null}
    </div>` : null}

    ${others.length ? html`<section class="section"><div class="section-head"><h2>${t('track.moreBy', { name: track.artist.displayName })}</h2><a href=${`/u/${track.artist.username}`}>${t('common.showAll')}</a></div>
      <${TrackList} tracks=${others} /></section>` : null}
  </div>`;
}
