import { html, Icon, fmtTime, fmtNumber } from '../lib.js';
import { t, getLang, useLang } from '../i18n.js';
import { Cover, MenuButton } from './common.js';
import { playTrack, playerStore, toggle, enqueue, patchTrack } from '../player.js';
import { useStore } from '../lib.js';
import { useSession, openDialog, requireLogin, toggleLike, withOverride, useOverrides, isModerator } from '../session.js';
import { toast } from '../toast.js';
import { navigate } from '../router.js';
import { errorText } from '../i18n.js';

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export async function shareTrack(track) {
  const url = `${location.origin}/t/${track.id}`;
  if (await copyText(url)) toast(t('track.linkCopied'));
  else toast(url);
}

export function canManage(user, track) {
  return !!user && (user.id === track.userId || isModerator(user));
}

export function trackMenuItems(track, user, { onRemove, removeLabel } = {}) {
  return [
    { label: t('track.playNext'), icon: 'arrowright', onClick: () => { enqueue(track, { playNext: true }); toast(t('track.queued')); } },
    { label: t('track.addToQueue'), icon: 'queue', onClick: () => { enqueue(track); toast(t('track.queued')); } },
    { label: t('track.addToPlaylist'), icon: 'plus', onClick: () => { if (requireLogin('playlist')) openDialog('playlist-picker', { track }); } },
    onRemove ? { label: removeLabel || t('playlist.removeTrack'), icon: 'close', onClick: onRemove } : { hidden: true },
    'sep',
    { label: t('track.goToArtist'), icon: 'user', onClick: () => navigate(`/u/${track.artist.username}`) },
    { label: t('track.share'), icon: 'share', onClick: () => shareTrack(track) },
    { label: t('track.report'), icon: 'flag', onClick: () => openDialog('report', { track }) },
    canManage(user, track) ? 'sep' : { hidden: true },
    { label: t('track.edit'), icon: 'edit', hidden: !canManage(user, track), onClick: () => openDialog('edit-track', { track }) },
    { label: t('track.delete'), icon: 'trash', danger: true, hidden: !canManage(user, track), onClick: () => openDialog('delete-track', { track }) },
  ];
}

export function LikeButton({ track, small }) {
  useLang();
  useOverrides();
  const tr = withOverride(track);
  const onClick = async (e) => {
    e.stopPropagation();
    try { await toggleLike(track, patchTrack); } catch (err) { toast(errorText(err), 'error'); }
  };
  return html`<button type="button" class=${`iconbtn${small ? ' sm' : ''}${tr.liked ? ' liked' : ''}`} aria-pressed=${!!tr.liked}
    aria-label=${tr.liked ? t('track.unlike') : t('track.like')} onClick=${onClick}><${Icon} name="heart" /></button>`;
}

function usePlayState(track) {
  const state = useStore(playerStore, (s) => {
    const cur = s.queue[s.index];
    if (!cur || cur.id !== track.id) return 'none';
    return s.playing ? 'playing' : 'paused';
  });
  return state;
}

const Equalizer = ({ paused }) => html`<span class=${`eq${paused ? ' paused' : ''}`} aria-hidden="true"><i></i><i></i><i></i></span>`;

export function TrackRow({ track: base, index, context, onRemove, removeLabel, extra }) {
  useLang();
  useOverrides();
  const { user } = useSession();
  const track = withOverride(base);
  const state = usePlayState(track);
  const play = () => (state === 'none' ? playTrack(track, context) : toggle());
  return html`
    <li class=${`track${state !== 'none' ? ' is-current' : ''}`} data-track-id=${track.id} onDblClick=${play}>
      <button type="button" class="rowplay" aria-label=${state === 'playing' ? t('player.pause') : `${t('player.play')}: ${track.title}`} onClick=${play}>
        ${state === 'playing' ? html`<${Equalizer} />` : state === 'paused' ? html`<${Icon} name="play" />` : html`<span class="num" data-n=${index + 1} aria-hidden="true"></span>`}
      </button>
      <div onClick=${play} style="cursor:pointer"><${Cover} track=${track} /></div>
      <div class="t-main">
        <a class="t-title clamp" href=${`/t/${track.id}`}>${track.title}</a>
        <span class="t-sub clamp"><a href=${`/u/${track.artist.username}`}>${track.artist.displayName}</a>
          ${track.status !== 'published' ? html` <span class=${`badge ${track.status === 'pending' ? 'warn' : 'danger'}`}>${t(`status.${track.status}`)}</span>` : null}
          ${extra || null}
        </span>
      </div>
      <span class="t-genre clamp">${track.genre}</span>
      <span class="t-time mono">${fmtTime(track.duration)}</span>
      <div class="t-actions">
        <${LikeButton} track=${track} small />
        <${MenuButton} label=${t('common.more')} items=${trackMenuItems(track, user, { onRemove, removeLabel })} />
      </div>
    </li>`;
}

export function TrackList({ tracks, onRemove, removeLabel }) {
  const visible = tracks.filter((x) => !withOverride(x).deleted);
  useOverrides();
  return html`<ul class="tracklist">${visible.map((tr, i) => html`<${TrackRow} key=${tr.id} track=${tr} index=${i} context=${visible}
    onRemove=${onRemove ? () => onRemove(tr) : undefined} removeLabel=${removeLabel} />`)}</ul>`;
}

export function TrackCard({ track: base, context }) {
  useLang();
  useOverrides();
  const track = withOverride(base);
  const state = usePlayState(track);
  const play = () => (state === 'none' ? playTrack(track, context) : toggle());
  return html`
    <li class=${`card${state !== 'none' ? ' is-current' : ''}`} data-track-id=${track.id}>
      <${Cover} track=${track} />
      <button type="button" class="playbtn sm play-overlay" aria-label=${state === 'playing' ? t('player.pause') : `${t('player.play')}: ${track.title}`} onClick=${play}>
        <${Icon} name=${state === 'playing' ? 'pause' : 'play'} />
      </button>
      <div>
        <a class="card-title clamp stretch" style="display:block" href=${`/t/${track.id}`}>${track.title}</a>
        <div class="card-sub clamp"><a href=${`/u/${track.artist.username}`}>${track.artist.displayName}</a></div>
      </div>
    </li>`;
}

export function TrackGrid({ tracks }) {
  useOverrides();
  const visible = tracks.filter((x) => !withOverride(x).deleted);
  return html`<ul class="grid">${visible.map((tr) => html`<${TrackCard} key=${tr.id} track=${tr} context=${visible} />`)}</ul>`;
}

export function counts(track, lang = getLang()) {
  return { plays: fmtNumber(track.plays, lang), likes: fmtNumber(track.likes, lang) };
}
