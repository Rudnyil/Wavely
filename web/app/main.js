import { render } from 'preact';
import { html, Icon, LogoMark, api, useStore } from './lib.js';
import { t, useLang } from './i18n.js';
import { routeStore, matchRoute, navigate, useRoute } from './router.js';
import { session, useSession, refreshSession, openDialog, logout, isModerator, ui } from './session.js';
import { PlayerBar, NowPlayingSheet } from './components/player-ui.js';
import { DialogHost } from './components/dialogs.js';
import { MenuButton, Empty, Spinner } from './components/common.js';
import { toastStore, toast } from './toast.js';
import { toggle, next, prev, seekBy, toggleMute, currentTrack } from './player.js';
import { HomePage } from './pages/home.js';
import { SearchPage } from './pages/search.js';
import { TrackPage } from './pages/track.js';
import { ArtistPage } from './pages/artist.js';
import { LibraryPage, PlaylistPage } from './pages/library.js';
import { SettingsPage } from './pages/settings.js';
import { AdminPage } from './pages/admin.js';
import { AboutPage } from './pages/about.js';
import { useEffect, useRef, useState } from 'preact/hooks';

const NavLink = ({ href, icon, label, path, match }) => {
  const active = match ? match(path) : path === href;
  return html`<a href=${href} aria-current=${active ? 'page' : undefined}><${Icon} name=${icon} />${label}</a>`;
};

function Sidebar({ path }) {
  const { user, config } = useSession();
  return html`<nav class="sidebar" aria-label=${t('nav.main')}>
    <a class="brand" href="/"><${LogoMark} id="side" /><span>${config.name}</span></a>
    <div class="nav">
      <${NavLink} href="/" icon="home" label=${t('nav.home')} path=${path} />
      <${NavLink} href="/search" icon="search" label=${t('nav.search')} path=${path} match=${(p) => p === '/search'} />
      <${NavLink} href="/library" icon="library" label=${t('nav.library')} path=${path} />
      ${isModerator(user) ? html`<${NavLink} href="/admin" icon="shield" label=${t('nav.admin')} path=${path} />` : null}
    </div>
    ${config.canUpload ? html`<button class="btn primary" onClick=${() => openDialog('upload')}><${Icon} name="upload" />${t('nav.upload')}</button>` : null}
    <div class="side-foot">
      <a href="/about">${t('nav.about')}</a>
      <a href="/settings">${t('nav.settings')}</a>
      <span>${config.name} v${config.version}</span>
    </div>
  </nav>`;
}

function Topbar({ path, search }) {
  const { user, config } = useSession();
  const params = new URLSearchParams(search);
  const [q, setQ] = useState(path === '/search' ? params.get('q') || '' : '');
  const input = useRef(null);
  // Mirror the URL into the input only when the URL's query really changed (back/forward, links), so typing is never overwritten.
  const urlQ = path === '/search' ? params.get('q') || '' : '';
  const prevUrlQ = useRef(urlQ);
  useEffect(() => { if (urlQ !== prevUrlQ.current) { prevUrlQ.current = urlQ; setQ(urlQ); } }, [urlQ]);
  useEffect(() => {
    if (q === (new URLSearchParams(search).get('q') || '') && path === '/search') return undefined;
    if (path !== '/search' && !q) return undefined;
    const id = setTimeout(() => {
      // Read the live URL: filters may have changed while the user was typing.
      const onSearch = location.pathname === '/search';
      const p = new URLSearchParams(onSearch ? location.search : '');
      if (q) p.set('q', q); else p.delete('q');
      navigate(`/search?${p}`, { replace: onSearch });
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const menu = user ? [
    { label: t('nav.profile'), icon: 'user', onClick: () => navigate(`/u/${user.username}`) },
    { label: t('nav.settings'), icon: 'settings', onClick: () => navigate('/settings') },
    isModerator(user) ? { label: t('nav.admin'), icon: 'shield', onClick: () => navigate('/admin') } : { hidden: true },
    'sep',
    { label: t('auth.signOut'), icon: 'logout', onClick: async () => { await logout(); toast(t('auth.signedOut')); } },
  ] : [];

  return html`<header class="topbar">
    <a class="brand-mobile" href="/" aria-label=${config.name}><${LogoMark} id="top" /></a>
    <form class="search" role="search" onSubmit=${(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q)}`); }}>
      <${Icon} name="search" />
      <input ref=${input} type="search" name="q" value=${q} placeholder=${t('search.placeholder')} aria-label=${t('search.placeholder')} autocomplete="off" enterkeyhint="search" onInput=${(e) => setQ(e.target.value)} />
    </form>
    <span class="spacer"></span>
    ${config.canUpload ? html`<button class="btn primary sm" onClick=${() => openDialog('upload')} aria-label=${t('nav.upload')}><${Icon} name="upload" /><span class="upload-label">${t('nav.upload')}</span></button>` : null}
    ${user ? html`<${MenuButton} label=${t('nav.account')} icon="user" small=${false} items=${menu} />`
      : html`<button class="btn sm" onClick=${() => openDialog('auth')}>${t('auth.signIn')}</button>`}
  </header>`;
}

function TabBar({ path }) {
  return html`<nav class="tabbar" aria-label=${t('nav.main')}>
    <a href="/" aria-current=${path === '/' ? 'page' : undefined}><${Icon} name="home" />${t('nav.home')}</a>
    <a href="/search" aria-current=${path === '/search' ? 'page' : undefined}><${Icon} name="search" />${t('nav.search')}</a>
    <a href="/library" aria-current=${path === '/library' ? 'page' : undefined}><${Icon} name="library" />${t('nav.library')}</a>
    <a href="/settings" aria-current=${path === '/settings' || path === '/about' || path === '/admin' ? 'page' : undefined}><${Icon} name="settings" />${t('nav.settings')}</a>
  </nav>`;
}

const NotFound = () => html`<div class="page"><${Empty} icon="music" title=${t('notfound.title')}><a class="btn" href="/">${t('nav.home')}</a><//></div>`;

function Page({ path }) {
  let m;
  if (path === '/') return html`<${HomePage} />`;
  if (path === '/search') return html`<${SearchPage} />`;
  if (path === '/library') return html`<${LibraryPage} />`;
  if (path === '/settings') return html`<${SettingsPage} />`;
  if (path === '/admin') return html`<${AdminPage} />`;
  if (path === '/about') return html`<${AboutPage} />`;
  if ((m = matchRoute('/t/:id', path))) return html`<${TrackPage} key=${m.id} id=${m.id} />`;
  if ((m = matchRoute('/u/:username', path))) return html`<${ArtistPage} key=${m.username} username=${m.username} />`;
  if ((m = matchRoute('/p/:id', path))) return html`<${PlaylistPage} key=${m.id} id=${m.id} />`;
  return html`<${NotFound} />`;
}

function Toasts() {
  const { items } = useStore(toastStore);
  return html`<div class="toasts" role="status" aria-live="polite">${items.map((x) => html`<div key=${x.id} class=${`toast ${x.kind}`}>${x.message}</div>`)}</div>`;
}

function App() {
  useLang();
  const { ready } = useSession();
  const { path, search } = useRoute();

  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      const tag = el?.tagName;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(tag) || el?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.code === 'Space' && currentTrack()) { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && e.shiftKey) seekBy(10);
      else if (e.key === 'ArrowLeft' && e.shiftKey) seekBy(-10);
      else if (e.key === 'n' || e.key === 'N') next();
      else if (e.key === 'p' || e.key === 'P') prev();
      else if (e.key === 'm' || e.key === 'M') toggleMute();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return html`<${Spinner} />`;
  return html`
    <div class="app">
      <${Sidebar} path=${path} />
      <div class="main" id="main" tabindex="-1">
        <${Topbar} path=${path} search=${search} />
        <main><${Page} path=${path} /></main>
      </div>
      <${PlayerBar} />
      <${TabBar} path=${path} />
    </div>
    <${NowPlayingSheet} />
    <${DialogHost} />
    <${Toasts} />`;
}

refreshSession().catch(() => session.set({ ready: true, user: null, config: { name: 'Wavely', registration: 'open', canUpload: false, needsSetup: false, version: '' } }))
  .finally(() => render(html`<${App} />`, document.getElementById('app')));
