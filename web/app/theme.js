import { storage } from './lib.js';

export function getTheme() { const v = storage.get('theme', 'system'); return ['dark', 'light'].includes(v) ? v : 'system'; }

export function setTheme(theme) {
  storage.set('theme', theme);
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
}
