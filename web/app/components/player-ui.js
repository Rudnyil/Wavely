import { html, Icon, fmtTime, useStore, api } from '../lib.js';
import { t, useLang } from '../i18n.js';
import {
  playerStore, timeStore, toggle, next, prev, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat,
  playQueueIndex, removeFromQueue,
} from '../player.js';
import { ui } from '../session.js';
import { Cover } from './common.js';
import { LikeButton } from './tracks.js';
import { Waveform } from './waveform.js';
import { useEffect, useRef, useState } from 'preact/hooks';

const pct = (v, max) => `${max ? Math.min(100, (v / max) * 100) : 0}%`;

function SeekBar({ label }) {
  const { current, duration } = useStore(timeStore);
  return html`<div class="p-seek">
    <span class="mono" aria-hidden="true">${fmtTime(current)}</span>
    <input type="range" min="0" max=${duration || 0} step="0.1" value=${current} aria-label=${label || t('player.seek')}
      aria-valuetext=${`${fmtTime(current)} / ${fmtTime(duration)}`} style=${`--pct:${pct(current, duration)}`}
      onInput=${(e) => seek(Number(e.target.value))} />
    <span class="mono" aria-hidden="true">${fmtTime(duration)}</span>
  </div>`;
}

function Controls({ big }) {
  const s = useStore(playerStore);
  const btn = big ? 'iconbtn' : 'iconbtn sm';
  return html`<div class="p-controls">
    <button type="button" class=${`${btn} desktop-only${s.shuffle ? ' active' : ''}`} aria-pressed=${s.shuffle} aria-label=${t('player.shuffle')} onClick=${toggleShuffle}><${Icon} name="shuffle" /></button>
    <button type="button" class=${`${btn} desktop-only`} aria-label=${t('player.prev')} onClick=${prev}><${Icon} name="prev" /></button>
    <button type="button" class=${big ? 'playbtn' : 'playbtn sm'} aria-label=${s.playing ? t('player.pause') : t('player.play')} onClick=${toggle}>
      ${s.loading && s.playing ? html`<div class="spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,.3);border-top-color:#fff"></div>` : html`<${Icon} name=${s.playing ? 'pause' : 'play'} />`}
    </button>
    <button type="button" class=${btn} aria-label=${t('player.next')} onClick=${() => next()}><${Icon} name="next" /></button>
    <button type="button" class=${`${btn} desktop-only${s.repeat !== 'off' ? ' active' : ''}`} aria-label=${`${t('player.repeat')}: ${t(`player.repeat.${s.repeat}`)}`} onClick=${cycleRepeat}>
      <${Icon} name=${s.repeat === 'one' ? 'repeat1' : 'repeat'} />
    </button>
  </div>`;
}

function MiniProgress() {
  const { current, duration } = useStore(timeStore);
  return html`<div class="player-progress mini-only" aria-hidden="true"><i style=${`width:${pct(current, duration)}`}></i></div>`;
}

export function PlayerBar() {
  useLang();
  const s = useStore(playerStore);
  const track = s.queue[s.index];
  const openSheet = (tab = 'now') => ui.set({ sheet: true, sheetTab: tab });
  return html`
    <footer class=${`player${track ? '' : ' is-empty'}`} aria-label=${t('player.label')}>
      <${MiniProgress} />
      <div class="p-now">
        ${track ? html`
          <button type="button" class="coverbtn" style="border:0;background:none;padding:0;width:56px;flex:none" aria-label=${t('player.open')} onClick=${() => openSheet('now')}><${Cover} track=${track} /></button>
          <div class="p-info grow">
            <a class="p-title clamp" href=${`/t/${track.id}`} data-testid="player-title">${track.title}</a>
            <span class="p-artist clamp"><a href=${`/u/${track.artist.username}`}>${track.artist.displayName}</a></span>
          </div>
          <${LikeButton} track=${track} small />` : html`<span class="p-empty">${t('player.nothing')}</span>`}
      </div>
      <div class="p-center">
        <div inert=${!track}><${Controls} /></div>
        <${SeekBar} />
      </div>
      <div class="p-right" inert=${!track}>
        <button type="button" class="iconbtn sm" aria-label=${t('player.queue')} onClick=${() => openSheet('queue')}><${Icon} name="queue" /></button>
        <button type="button" class="iconbtn sm" aria-label=${s.muted ? t('player.unmute') : t('player.mute')} onClick=${toggleMute}><${Icon} name=${s.muted || s.volume === 0 ? 'mute' : 'volume'} /></button>
        <input class="volume" type="range" min="0" max="1" step="0.01" value=${s.muted ? 0 : s.volume} aria-label=${t('player.volume')}
          style=${`--pct:${(s.muted ? 0 : s.volume) * 100}%`} onInput=${(e) => setVolume(Number(e.target.value))} />
      </div>
    </footer>`;
}

export function NowPlayingSheet() {
  useLang();
  const { sheet, sheetTab } = useStore(ui);
  const s = useStore(playerStore);
  const closeBtn = useRef(null);
  const track = s.queue[s.index];
  const [peaks, setPeaks] = useState(null);
  useEffect(() => {
    setPeaks(null);
    if (!sheet || !track) return undefined;
    let live = true;
    api(`/tracks/${track.id}`).then((d) => { if (live) setPeaks(d.peaks); }).catch(() => {});
    return () => { live = false; };
  }, [sheet, track?.id]);
  const close = () => ui.set({ sheet: false });
  useEffect(() => {
    if (!sheet) return undefined;
    closeBtn.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);
  if (!sheet) return null;
  const tab = (name) => ui.set({ sheetTab: name });
  return html`
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${t('player.nowPlaying')}>
      <div class="sheet-head">
        <button ref=${closeBtn} type="button" class="iconbtn" aria-label=${t('common.close')} onClick=${close}><${Icon} name="down" /></button>
        <div class="tabs" role="tablist" style="margin:0;border:0">
          <button role="tab" aria-selected=${sheetTab === 'now'} onClick=${() => tab('now')}>${t('player.nowPlaying')}</button>
          <button role="tab" aria-selected=${sheetTab === 'queue'} onClick=${() => tab('queue')}>${t('player.queue')}</button>
        </div>
        <span style="width:40px"></span>
      </div>
      ${sheetTab === 'now' ? (track ? html`
        <div class="sheet-body">
          <${Cover} track=${track} lg />
          <div class="row">
            <div class="grow">
              <div class="sheet-title clamp"><a href=${`/t/${track.id}`} onClick=${close}>${track.title}</a></div>
              <div class="muted clamp"><a href=${`/u/${track.artist.username}`} onClick=${close}>${track.artist.displayName}</a></div>
            </div>
            <${LikeButton} track=${track} />
          </div>
          <${Waveform} peaks=${peaks || fallbackPeaks()} duration=${track.duration} active />
          <${SeekBar} label=${t('player.seek')} />
          <${SheetControls} />
        </div>` : html`<div class="empty">${t('player.nothing')}</div>`)
      : html`<div class="queue-list" role="list">
          ${s.queue.map((q, i) => html`
            <div class=${`queue-item${i === s.index ? ' is-current' : ''}`} role="listitem" key=${`${q.id}-${i}`}>
              <${Cover} track=${q} />
              <button type="button" class="grow" style="background:none;border:0;text-align:left;padding:4px" onClick=${() => playQueueIndex(i)}>
                <div class="clamp" style="font-weight:600">${q.title}</div>
                <div class="muted clamp" style="font-size:.85rem">${q.artist.displayName}</div>
              </button>
              <span class="mono faint">${fmtTime(q.duration)}</span>
              ${i === s.index ? null : html`<button type="button" class="iconbtn sm" aria-label=${t('player.removeFromQueue')} onClick=${() => removeFromQueue(i)}><${Icon} name="close" /></button>`}
            </div>`)}
          ${s.queue.length ? null : html`<div class="empty">${t('player.queueEmpty')}</div>`}
        </div>`}
    </div>`;
}

function SheetControls() {
  const s = useStore(playerStore);
  return html`<div class="p-controls">
    <button type="button" class=${`iconbtn${s.shuffle ? ' active' : ''}`} aria-pressed=${s.shuffle} aria-label=${t('player.shuffle')} onClick=${toggleShuffle}><${Icon} name="shuffle" /></button>
    <button type="button" class="iconbtn" aria-label=${t('player.prev')} onClick=${prev}><${Icon} name="prev" /></button>
    <button type="button" class="playbtn" aria-label=${s.playing ? t('player.pause') : t('player.play')} onClick=${toggle}><${Icon} name=${s.playing ? 'pause' : 'play'} /></button>
    <button type="button" class="iconbtn" aria-label=${t('player.next')} onClick=${() => next()}><${Icon} name="next" /></button>
    <button type="button" class=${`iconbtn${s.repeat !== 'off' ? ' active' : ''}`} aria-label=${`${t('player.repeat')}: ${t(`player.repeat.${s.repeat}`)}`} onClick=${cycleRepeat}><${Icon} name=${s.repeat === 'one' ? 'repeat1' : 'repeat'} /></button>
  </div>`;
}

// Lists don't carry peaks; the sheet draws a flat placeholder until the track detail is fetched.
const fallbackPeaks = () => new Array(64).fill(35);
