import { createStore, useStore } from './lib.js';

function current() {
  return { path: location.pathname, search: location.search };
}
export const routeStore = createStore(current());

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) { location.href = to; return; }
  const target = url.pathname + url.search;
  if (target === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', target);
  routeStore.set(current());
  const main = document.getElementById('main');
  if (main) main.scrollTo(0, 0);
}

window.addEventListener('popstate', () => routeStore.set(current()));

// Same-origin links navigate without reloading.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
  if (a.pathname.startsWith('/api/') || a.pathname.startsWith('/vendor/')) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
});

export function useRoute() {
  return useStore(routeStore);
}

/** Matches "/t/:id" style patterns. */
export function matchRoute(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i += 1) {
    if (p[i].startsWith(':')) {
      try { params[p[i].slice(1)] = decodeURIComponent(s[i]); } catch { return null; }
    } else if (p[i] !== s[i]) return null;
  }
  return params;
}
