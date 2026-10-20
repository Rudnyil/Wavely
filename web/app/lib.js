import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';

export const html = htm.bind(h);

/* ---- tiny store --------------------------------------------------------- */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
      subs.forEach((fn) => fn());
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export function useStore(store, selector = (s) => s) {
  const [value, setValue] = useState(() => selector(store.get()));
  useEffect(() => {
    const sync = () => {
      const next = selector(store.get());
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    };
    sync();
    return store.subscribe(sync);
  }, [store]);
  return value;
}

/* ---- safe storage --------------------------------------------------------- */
export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(`wavely.${key}`); return v === null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(`wavely.${key}`, String(value)); } catch { /* ignore */ } },
};

/* ---- API -------------------------------------------------------------------- */
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const headers = { 'X-Requested-With': 'wavely' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Network error');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || res.statusText);
  return data;
}

/** multipart upload with progress (fetch cannot report upload progress). */
export function uploadForm(path, form, { method = 'POST', onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    xhr.setRequestHeader('X-Requested-With', 'wavely');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Network error'));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error?.code || 'error', data?.error?.message || xhr.statusText));
    };
    xhr.send(form);
  });
}

/* ---- formatting --------------------------------------------------------------- */
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtBytes(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtNumber(n, lang) {
  return new Intl.NumberFormat(lang, { notation: n >= 10000 ? 'compact' : 'standard' }).format(n);
}

export function fmtDate(ms, lang) {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(ms));
}

/* ---- icons -------------------------------------------------------------------- */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  library: 'M4 5v14M9 5v14M14.5 6.5l4.5 12.5',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  heart: 'M12 20s-7-4.4-9.3-9A5.2 5.2 0 0 1 12 6.5 5.2 5.2 0 0 1 21.3 11C19 15.6 12 20 12 20z',
  play: { d: 'M8 5v14l11-7z', fill: true },
  pause: { d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', fill: true },
  next: { d: 'M6 5l9 7-9 7zM17 5h2v14h-2z', fill: true },
  prev: { d: 'M18 5l-9 7 9 7zM5 5h2v14H5z', fill: true },
  shuffle: 'M3 17h3a5 5 0 0 0 4-2l4-6a5 5 0 0 1 4-2h3m0 0-3-3m3 3-3 3M3 7h3a5 5 0 0 1 4 2M14 15a5 5 0 0 0 4 2h3m0 0-3-3m3 3-3 3',
  repeat: 'M4 11V9a3 3 0 0 1 3-3h13m0 0-3-3m3 3-3 3M20 13v2a3 3 0 0 1-3 3H4m0 0 3 3m-3-3 3-3',
  repeat1: 'M4 11V9a3 3 0 0 1 3-3h13m0 0-3-3m3 3-3 3M20 13v2a3 3 0 0 1-3 3H4m0 0 3 3m-3-3 3-3M11 10l1.5-1v6',
  volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6m0-6-5 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  queue: 'M4 6h13M4 12h13M4 18h7M17 16l5 3-5 3z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  check: 'M5 12l5 5L20 7',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  download: 'M12 4v12m0 0-4 4m4-4 4 4M4 20h16',
  logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9',
  arrowup: 'M12 19V5m0 0-6 6m6-6 6 6',
  arrowdown: 'M12 5v14m0 0-6-6m6 6 6-6',
  arrowright: 'M5 12h14m0 0-6-6m6 6-6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  github: 'M9 19c-4 1.2-4-2-6-2m12 4v-3.2a2.8 2.8 0 0 0-.8-2.2c2.700-.3 5.500-1.300 5.500-6a4.600 4.600 0 0 0-1.300-3.200 4.300 4.300 0 0 0-.1-3.200s-1-.3-3.400 1.300a11.600 11.600 0 0 0-6 0C6.500 2.800 5.500 3.100 5.500 3.100a4.300 4.300 0 0 0-.1 3.200A4.600 4.600 0 0 0 4 9.500c0 4.700 2.800 5.700 5.500 6A2.800 2.800 0 0 0 8.700 17.700V21',
};

export function Icon({ name, size }) {
  const def = ICONS[name];
  if (!def) return null;
  const d = typeof def === 'string' ? def : def.d;
  const filled = typeof def !== 'string' && def.fill;
  const style = size ? `width:${size}px;height:${size}px` : undefined;
  return html`<svg viewBox="0 0 24 24" style=${style} fill=${filled ? 'currentColor' : 'none'} stroke=${filled ? 'none' : 'currentColor'}
    stroke-width=${name === 'more' ? 3 : 2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d=${d} /></svg>`;
}

export const LogoMark = ({ id = 'a' }) => html`<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id=${`wv-logo-${id}`} gradientUnits="userSpaceOnUse" x1="8" y1="8" x2="56" y2="56"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><g fill="none" stroke=${`url(#wv-logo-${id})`} stroke-width="6" stroke-linecap="round"><path d="M10 36v-8"/><path d="M21 44V20"/><path d="M32 52V12"/><path d="M43 44V20"/><path d="M54 36v-8"/></g></svg>`;
