import { api, createStore, storage } from './lib.js';
import { t } from './i18n.js';
import { toast } from './toast.js';

/** State that changes rarely. Time lives in its own store because it updates several times per second. */
export const playerStore = createStore({
  queue: [],
  index: -1,
  playing: false,
  loading: false,
  volume: Number(storage.get('volume', 0.9)),
  muted: false,
  shuffle: storage.get('shuffle') === '1',
  repeat: storage.get('repeat', 'off'), // off | all | one
});
export const timeStore = createStore({ current: 0, duration: 0 });

const audio = new Audio();
audio.preload = 'auto';
audio.volume = playerStore.get().volume;

let order = []; // play order (indices into queue)
let pos = -1; // position inside `order`
let listened = 0; // seconds actually listened for the current track
let counted = false;
let lastTime = 0;

export const currentTrack = () => {
  const s = playerStore.get();
  return s.queue[s.index] || null;
};

function buildOrder(keepIndex) {
  const { queue, shuffle } = playerStore.get();
  order = queue.map((_, i) => i);
  if (shuffle) {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (keepIndex >= 0) {
      order = [keepIndex, ...order.filter((i) => i !== keepIndex)];
    }
  }
  pos = keepIndex >= 0 ? order.indexOf(keepIndex) : -1;
}

function load(index, { autoplay = true } = {}) {
  const s = playerStore.get();
  const track = s.queue[index];
  if (!track) return;
  pos = order.indexOf(index);
  listened = 0;
  counted = false;
  lastTime = 0;
  audio.src = track.audioUrl;
  playerStore.set({ index, loading: true });
  timeStore.set({ current: 0, duration: track.duration || 0 });
  updateMediaSession(track);
  if (autoplay) audio.play().catch(onPlayError);
}

function onPlayError(err) {
  if (err && err.name === 'AbortError') return;
  if (err && err.name === 'NotAllowedError') { playerStore.set({ playing: false, loading: false }); return; }
  playerStore.set({ playing: false, loading: false });
  toast(t('player.error'), 'error');
}

export function playQueue(tracks, startIndex = 0) {
  if (!tracks.length) return;
  playerStore.set({ queue: tracks.slice(), index: startIndex });
  buildOrder(startIndex);
  load(startIndex);
}

export function playTrack(track, context) {
  const list = context && context.length ? context : [track];
  const idx = Math.max(0, list.findIndex((x) => x.id === track.id));
  const s = playerStore.get();
  if (s.queue[s.index]?.id === track.id && list.length === s.queue.length) {
    toggle();
    return;
  }
  playQueue(list, idx);
}

export function toggle() {
  if (!currentTrack()) return;
  if (audio.paused) audio.play().catch(onPlayError);
  else audio.pause();
}

export function next({ auto = false } = {}) {
  const s = playerStore.get();
  if (!s.queue.length) return;
  if (auto && s.repeat === 'one') { audio.currentTime = 0; audio.play().catch(onPlayError); return; }
  if (pos + 1 < order.length) { load(order[pos + 1]); return; }
  // End of the queue: a manual "next" and repeat-all wrap around, automatic advance otherwise stops.
  if (s.repeat === 'all' || !auto) {
    if (s.shuffle) buildOrder(-1);
    load(order[0]);
    return;
  }
  audio.pause();
  audio.currentTime = 0;
}

export function prev() {
  if (audio.currentTime > 3 || pos <= 0) { audio.currentTime = 0; return; }
  load(order[pos - 1]);
}

export function seek(sec) {
  if (!Number.isFinite(sec)) return;
  const max = audio.duration || timeStore.get().duration || 0;
  audio.currentTime = Math.max(0, Math.min(sec, max || sec));
  lastTime = audio.currentTime;
  timeStore.set({ current: audio.currentTime });
}

export function seekBy(delta) { seek(audio.currentTime + delta); }

export function setVolume(v) {
  const volume = Math.max(0, Math.min(1, v));
  audio.volume = volume;
  audio.muted = false;
  storage.set('volume', volume);
  playerStore.set({ volume, muted: false });
}

export function toggleMute() {
  audio.muted = !audio.muted;
  playerStore.set({ muted: audio.muted });
}

export function toggleShuffle() {
  const shuffle = !playerStore.get().shuffle;
  storage.set('shuffle', shuffle ? '1' : '0');
  playerStore.set({ shuffle });
  buildOrder(playerStore.get().index);
}

export function cycleRepeat() {
  const order3 = ['off', 'all', 'one'];
  const repeat = order3[(order3.indexOf(playerStore.get().repeat) + 1) % 3];
  storage.set('repeat', repeat);
  playerStore.set({ repeat });
}

export function enqueue(track, { playNext = false } = {}) {
  const s = playerStore.get();
  if (!s.queue.length) { playQueue([track], 0); return; }
  const queue = s.queue.slice();
  if (playNext) {
    const insertAt = s.index + 1;
    queue.splice(insertAt, 0, track);
    playerStore.set({ queue });
    // indices after the insertion point shifted by one
    order = order.map((i) => (i >= insertAt ? i + 1 : i));
    order.splice(pos + 1, 0, insertAt);
  } else {
    queue.push(track);
    playerStore.set({ queue });
    order.push(queue.length - 1);
  }
}

export function removeFromQueue(i) {
  const s = playerStore.get();
  if (i === s.index || i < 0 || i >= s.queue.length) return;
  const queue = s.queue.filter((_, k) => k !== i);
  const index = i < s.index ? s.index - 1 : s.index;
  playerStore.set({ queue, index });
  buildOrder(index);
}

export function playQueueIndex(i) { if (playerStore.get().queue[i]) load(i); }

/** Keeps the displayed like state / counters of queued tracks in sync after an action elsewhere. */
export function patchTrack(id, patch) {
  const s = playerStore.get();
  if (!s.queue.some((x) => x.id === id)) return;
  playerStore.set({ queue: s.queue.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

/** Called when a track is deleted/removed so the player never points at a dead track. */
export function dropTrack(id) {
  const s = playerStore.get();
  const i = s.queue.findIndex((x) => x.id === id);
  if (i < 0) return;
  if (i === s.index) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  const queue = s.queue.filter((x) => x.id !== id);
  const index = i < s.index ? s.index - 1 : i === s.index ? -1 : s.index;
  playerStore.set({ queue, index, playing: i === s.index ? false : s.playing });
  buildOrder(index);
}

// ---- audio element events ------------------------------------------------------
audio.addEventListener('play', () => playerStore.set({ playing: true }));
audio.addEventListener('pause', () => playerStore.set({ playing: false }));
audio.addEventListener('waiting', () => playerStore.set({ loading: true }));
audio.addEventListener('playing', () => playerStore.set({ loading: false, playing: true }));
audio.addEventListener('canplay', () => playerStore.set({ loading: false }));
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration)) timeStore.set({ duration: audio.duration });
});
audio.addEventListener('ended', () => next({ auto: true }));
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  playerStore.set({ playing: false, loading: false });
  toast(t('player.error'), 'error');
});
audio.addEventListener('timeupdate', () => {
  const cur = audio.currentTime;
  timeStore.set({ current: cur });
  const delta = cur - lastTime;
  lastTime = cur;
  if (!audio.paused && delta > 0 && delta < 1.5) listened += delta;
  const track = currentTrack();
  const threshold = Math.min(30, (track?.duration || 60) / 2);
  if (!counted && track && listened >= threshold) {
    counted = true;
    api(`/tracks/${track.id}/play`, { method: 'POST', body: {} }).then((r) => {
      if (r && typeof r.plays === 'number') patchTrack(track.id, { plays: r.plays });
    }).catch(() => {});
  }
});

// ---- Media Session (lock screen / media keys) ----------------------------------------
function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist.displayName,
      album: 'Wavely',
      artwork: [{ src: track.coverUrl, sizes: '640x640', type: track.hasCover ? 'image/jpeg' : 'image/svg+xml' }],
    });
  } catch { /* unsupported */ }
}
if ('mediaSession' in navigator) {
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported */ } };
  set('play', () => audio.play().catch(onPlayError));
  set('pause', () => audio.pause());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekbackward', () => seekBy(-10));
  set('seekforward', () => seekBy(10));
  set('seekto', (d) => seek(d.seekTime));
}

// Test hook: lets automated tests inspect the element without reaching into module scope.
window.__wavelyAudio = audio;
