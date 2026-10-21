import { html, Icon, api, fmtBytes, fmtDate, fmtNumber } from '../lib.js';
import { t, tn, useLang, errorText, getLang } from '../i18n.js';
import { useAsync, Spinner, Empty, Failed } from '../components/common.js';
import { TrackList } from '../components/tracks.js';
import { useSession, isModerator, useDataVersion, invalidate, openDialog } from '../session.js';
import { toast } from '../toast.js';
import { navigate, useRoute } from '../router.js';
import { usePageTitle } from './util.js';

const TABS = ['reports', 'queue', 'removed', 'users'];

export function AdminPage() {
  useLang();
  usePageTitle(t('nav.admin'));
  const { user } = useSession();
  const { search } = useRoute();
  const version = useDataVersion();
  const requested = new URLSearchParams(search).get('tab');
  const tabs = TABS.filter((x) => x !== 'users' || user?.role === 'admin');
  const tab = tabs.includes(requested) ? requested : 'reports';
  const stats = useAsync(() => (isModerator(user) ? api('/admin/stats') : Promise.resolve(null)), [user?.id, version]);
  if (!isModerator(user)) return html`<div class="page"><${Empty} icon="shield" title=${t('admin.denied')} /></div>`;
  const s = stats.data;
  const lang = getLang();
  return html`<div class="page">
    <h1 style="margin-bottom:16px">${t('nav.admin')}</h1>
    ${s ? html`<div class="stats">
      ${[['users', s.users], ['tracks', s.tracks], ['pending', s.pending], ['openReports', s.openReports], ['plays', s.plays]].map(([k, v]) => html`<div class="stat"><b>${fmtNumber(v, lang)}</b><span>${t(`admin.stat.${k}`)}</span></div>`)}
      <div class="stat"><b>${fmtBytes(s.storageBytes)}</b><span>${t('admin.stat.storage')}</span></div></div>` : null}
    <div class="tabs" role="tablist">${tabs.map((n) => html`<button role="tab" aria-selected=${tab === n} onClick=${() => navigate(`/admin?tab=${n}`, { replace: true })}>
      ${t(`admin.tab.${n}`)}${n === 'reports' && s?.openReports ? html` <span class="badge danger">${s.openReports}</span>` : ''}${n === 'queue' && s?.pending ? html` <span class="badge warn">${s.pending}</span>` : ''}</button>`)}</div>
    ${tab === 'reports' ? html`<${Reports} version=${version} />` : tab === 'users' ? html`<${Users} me=${user} />` : html`<${TrackQueue} status=${tab === 'queue' ? 'pending' : 'removed'} version=${version} />`}
  </div>`;
}

function Reports({ version }) {
  const [status, setStatus] = useStateLocal('open');
  const list = useAsync(() => api(`/admin/reports?status=${status}`), [status, version]);
  const resolve = async (r, resolution) => {
    const send = async (reason) => { await api(`/admin/reports/${r.id}/resolve`, { method: 'POST', body: { resolution, reason } }); toast(t('common.saved')); invalidate(); };
    if (resolution === 'removed') { openDialog('remove-track', { track: { title: r.trackTitle }, onConfirm: send }); return; }
    try { await send(''); } catch (e) { toast(errorText(e), 'error'); }
  };
  return html`<div>
    <div class="chips" style="margin-bottom:14px"><button class="chip" aria-pressed=${status === 'open'} onClick=${() => setStatus('open')}>${t('admin.open')}</button>
      <button class="chip" aria-pressed=${status === 'resolved'} onClick=${() => setStatus('resolved')}>${t('admin.resolved')}</button></div>
    ${list.loading ? html`<${Spinner} />` : list.error ? html`<${Failed} onRetry=${list.reload} />` : list.data.items.length === 0 ? html`<${Empty} icon="check" title=${t('admin.noReports')} />` : html`
    <table class="table"><thead><tr><th>${t('admin.track')}</th><th>${t('report.reason')}</th><th>${t('report.details')}</th><th></th></tr></thead>
      <tbody>${list.data.items.map((r) => html`<tr key=${r.id} data-report-id=${r.id}>
        <td><a href=${`/t/${r.trackId}`}><strong>${r.trackTitle}</strong></a><div class="faint">@${r.artist}${r.trackStatus === 'removed' ? html` <span class="badge danger">${t('status.removed')}</span>` : ''}</div></td>
        <td>${t(`report.reason.${r.reason}`)}<div class="faint">${r.reporter ? `@${r.reporter}` : t('admin.anonymous')}</div></td>
        <td style="white-space:pre-wrap;word-break:break-word">${r.details || '—'}${r.contact ? html`<div class="faint">${r.contact}</div>` : ''}</td>
        <td>${r.status === 'open' ? html`<div class="row wrap">
          <button class="btn sm" onClick=${() => resolve(r, 'dismissed')}>${t('admin.dismiss')}</button>
          <button class="btn sm danger" onClick=${() => resolve(r, 'removed')}>${t('admin.removeTrack')}</button></div>` : html`<span class="badge">${t(`admin.resolution.${r.resolution}`)}</span>`}</td></tr>`)}</tbody></table>`}
  </div>`;
}

function TrackQueue({ status, version }) {
  const list = useAsync(() => api(`/admin/tracks?status=${status}`), [status, version]);
  const set = async (track, to) => {
    const send = async (reason) => { await api(`/admin/tracks/${track.id}/status`, { method: 'POST', body: { status: to, reason } }); toast(t('common.saved')); invalidate(); };
    if (to === 'removed') { openDialog('remove-track', { track, onConfirm: send }); return; }
    try { await send(''); } catch (e) { toast(errorText(e), 'error'); }
  };
  if (list.loading) return html`<${Spinner} />`;
  if (list.error) return html`<${Failed} onRetry=${list.reload} />`;
  if (!list.data.items.length) return html`<${Empty} icon="check" title=${t(status === 'pending' ? 'admin.queueEmpty' : 'admin.removedEmpty')} />`;
  return html`<ul class="stack" style="gap:6px">${list.data.items.map((tr) => html`<li key=${tr.id} class="row wrap panel" style="padding:10px 14px" data-track-id=${tr.id}>
    <div class="grow"><a href=${`/t/${tr.id}`}><strong>${tr.title}</strong></a><div class="faint">@${tr.artist.username} · ${tr.genre || '—'}</div></div>
    <button class="btn sm primary" onClick=${() => set(tr, 'published')}>${status === 'pending' ? t('admin.approve') : t('admin.restore')}</button>
    ${status === 'pending' ? html`<button class="btn sm danger" onClick=${() => set(tr, 'removed')}>${t('admin.reject')}</button>` : null}</li>`)}</ul>`;
}

import { useState } from 'preact/hooks';
function useStateLocal(v) { return useState(v); }

function Users({ me }) {
  const [q, setQ] = useState('');
  const version = useDataVersion();
  const list = useAsync(() => api(`/admin/users?q=${encodeURIComponent(q)}`), [q, version]);
  const update = async (u, body) => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); toast(t('common.saved')); invalidate(); }
    catch (e) { toast(errorText(e), 'error'); }
  };
  const lang = getLang();
  return html`<div>
    <div class="field" style="max-width:360px"><label class="sr-only" for="u-search">${t('admin.searchUsers')}</label>
      <input id="u-search" class="input" type="search" placeholder=${t('admin.searchUsers')} value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    ${list.loading && !list.data ? html`<${Spinner} />` : html`<table class="table"><thead><tr><th>${t('auth.username')}</th><th>${t('admin.role')}</th><th>${t('admin.joined')}</th><th></th></tr></thead>
      <tbody>${(list.data?.items || []).map((u) => html`<tr key=${u.id} data-user=${u.username}>
        <td><strong>${u.displayName}</strong> <span class="faint">@${u.username}</span><div class="faint">${tn('count.tracks', u.tracks)}</div></td>
        <td><label class="sr-only" for=${`role-${u.id}`}>${t('admin.role')}</label>
          <select id=${`role-${u.id}`} class="select" style="width:auto" disabled=${u.id === me.id} onChange=${(e) => update(u, { role: e.target.value })}>
            ${['user', 'moderator', 'admin'].map((r) => html`<option value=${r} selected=${u.role === r}>${t(`role.${r}`)}</option>`)}</select></td>
        <td>${fmtDate(u.createdAt, lang)}</td>
        <td>${u.id === me.id ? null : html`<button class=${`btn sm${u.disabled ? '' : ' danger'}`} onClick=${() => update(u, { disabled: !u.disabled })}>${u.disabled ? t('admin.enable') : t('admin.disable')}</button>`}</td></tr>`)}</tbody></table>`}
  </div>`;
}
