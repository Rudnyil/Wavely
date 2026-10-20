import { html } from '../lib.js';
import { useEffect, useRef } from 'preact/hooks';
import { useStore } from '../lib.js';
import { timeStore, seek } from '../player.js';
import { t } from '../i18n.js';

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/**
 * Waveform drawn from the server-computed peaks. When `active` it follows playback and seeks on click/drag/arrows;
 * otherwise it is a static preview.
 */
export function Waveform({ peaks, duration, active }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const time = useStore(timeStore, (s) => s.current);
  const progress = active && duration ? Math.min(1, time / duration) : 0;

  useEffect(() => {
    const c = canvas.current;
    const w = wrap.current;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = w.clientWidth;
      const height = w.clientHeight;
      if (!width) return;
      c.width = Math.round(width * ratio);
      c.height = Math.round(height * ratio);
      const g = c.getContext('2d');
      g.scale(ratio, ratio);
      g.clearRect(0, 0, width, height);
      const n = Math.max(20, Math.floor(width / 5));
      const bar = width / n;
      const played = css('--accent-2');
      const rest = css('--bg-4');
      for (let i = 0; i < n; i += 1) {
        const p = peaks[Math.min(peaks.length - 1, Math.floor((i / n) * peaks.length))] ?? 0;
        const h = Math.max(3, (p / 100) * (height - 4));
        g.fillStyle = i / n < progress ? played : rest;
        g.beginPath();
        g.roundRect(i * bar + 1, (height - h) / 2, Math.max(1.5, bar - 2), h, 1.5);
        g.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [peaks, progress]);

  const fromEvent = (e) => {
    const r = wrap.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const onPointerDown = (e) => {
    if (!active) return;
    wrap.current.setPointerCapture(e.pointerId);
    seek(fromEvent(e));
  };
  const onPointerMove = (e) => { if (active && wrap.current.hasPointerCapture(e.pointerId)) seek(fromEvent(e)); };
  const onKey = (e) => {
    if (!active) return;
    const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (step) { e.preventDefault(); seek(time + step); }
    if (e.key === 'Home') { e.preventDefault(); seek(0); }
    if (e.key === 'End') { e.preventDefault(); seek(duration - 1); }
  };

  return html`<div class="wave" ref=${wrap} role=${active ? 'slider' : 'img'} aria-label=${t(active ? 'player.seek' : 'track.waveform')}
    tabindex=${active ? 0 : -1} aria-valuemin=${active ? 0 : undefined} aria-valuemax=${active ? Math.round(duration) : undefined}
    aria-valuenow=${active ? Math.round(time) : undefined}
    onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onKeyDown=${onKey}><canvas ref=${canvas}></canvas></div>`;
}
