import { html, Icon } from '../lib.js';
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { t } from '../i18n.js';

export function Cover({ track, lg }) {
  return html`<div class=${`cover${lg ? ' lg' : ''}`}><img src=${track.coverUrl} alt="" width="640" height="640" loading=${lg ? 'eager' : 'lazy'} decoding="async" /></div>`;
}

export const Spinner = () => html`<div class="loading" role="status" aria-label=${t('common.loading')}><div class="spinner"></div></div>`;

export const Empty = ({ icon = 'music', title, children }) => html`
  <div class="empty">
    <${Icon} name=${icon} />
    <h3>${title}</h3>
    ${children ? html`<div class="muted">${children}</div>` : null}
  </div>`;

export const Failed = ({ onRetry }) => html`
  <div class="empty" role="alert">
    <${Icon} name="music" />
    <h3>${t('err.generic')}</h3>
    ${onRetry ? html`<div><button type="button" class="btn" onClick=${onRetry}>${t('common.retry')}</button></div>` : null}
  </div>`;

/** Runs an async loader and tracks its state. Reloads when deps change. */
export function useAsync(loader, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reqId = useRef(0);
  const run = useCallback(() => {
    const id = ++reqId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    // A dropped connection is retried once before an error is shown.
    const attempt = (retry) => loader().then(
      (data) => { if (id === reqId.current) setState({ loading: false, data, error: null }); },
      (error) => {
        if (id !== reqId.current || error.name === 'AbortError') return;
        if (error.status === 0 && retry) { setTimeout(() => { if (id === reqId.current) attempt(false); }, 500); return; }
        setState({ loading: false, data: null, error });
      },
    );
    attempt(true);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); return () => { reqId.current += 1; }; }, [run]);
  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: run, setData };
}

export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d && d.open) d.close(); };
  }, []);
  return html`
    <dialog class="modal" ref=${ref} aria-labelledby="dlg-title"
      onCancel=${(e) => { e.preventDefault(); onClose(); }}
      onClick=${(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="modal-head">
        <h2 id="dlg-title">${title}</h2>
        <button class="iconbtn" type="button" aria-label=${t('common.close')} onClick=${onClose}><${Icon} name="close" /></button>
      </div>
      <div class="modal-body">${children}</div>
    </dialog>`;
}

/** "⋯" button with a popup menu. items: { label, icon, onClick, danger, hidden } or 'sep'. */
export function MenuButton({ items, label, icon = 'more', small = true, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const visible = items.filter((i) => i === 'sep' || !i.hidden);

  const toggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btn.current.getBoundingClientRect();
    setPos({ r });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const m = menu.current;
    const r = pos.r;
    const mh = m.offsetHeight;
    const mw = m.offsetWidth;
    const below = r.bottom + 6 + mh <= window.innerHeight - 8;
    m.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - mh - 6)}px`;
    m.style.left = `${Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))}px`;
    m.querySelector('button')?.focus();
    const close = () => setOpen(false);
    const onDown = (e) => { if (!m.contains(e.target) && !btn.current.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); btn.current.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = [...m.querySelectorAll('button')];
        const i = els.indexOf(document.activeElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : els.length - 1)) % els.length]?.focus();
      }
      if (e.key === 'Tab') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    document.getElementById('main')?.addEventListener('scroll', close, { once: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return html`
    <button ref=${btn} type="button" class=${`iconbtn${small ? ' sm' : ''} ${className}`} aria-label=${label} aria-haspopup="menu" aria-expanded=${open} onClick=${toggle}>
      <${Icon} name=${icon} />
    </button>
    ${open ? html`<div class="menu" role="menu" ref=${menu} style="top:0;left:0">
      ${visible.map((item, i) => (item === 'sep' ? html`<hr key=${`s${i}`} />` : html`
        <button key=${item.label} role="menuitem" type="button" class=${item.danger ? 'danger' : ''}
          onClick=${(e) => { e.stopPropagation(); setOpen(false); item.onClick(); }}>
          ${item.icon ? html`<${Icon} name=${item.icon} />` : null}<span>${item.label}</span>
        </button>`))}
    </div>` : null}`;
}

export function FormError({ error }) {
  return error ? html`<p class="error-text" role="alert">${error}</p>` : null;
}
