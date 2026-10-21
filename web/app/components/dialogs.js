import { html, Icon, api, uploadForm, fmtBytes } from '../lib.js';
import { t, errorText, useLang, tn } from '../i18n.js';
import { Modal, FormError, useAsync, Spinner, Failed } from './common.js';
import { useSession, ui, closeDialog, login, register, markDeleted, patchOverride, invalidate, refreshSession } from '../session.js';
import { useStore } from '../lib.js';
import { navigate } from '../router.js';
import { toast } from '../toast.js';
import { useRef, useState, useEffect } from 'preact/hooks';

/* ---- sign in / register ------------------------------------------------------ */
function AuthDialog({ reason }) {
  const { config } = useSession();
  const canRegister = config.registration !== 'closed' || config.needsSetup;
  const [mode, setMode] = useState(config.needsSetup ? 'register' : 'login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setBusy(true);
    setError('');
    try {
      if (mode === 'login') await login(f.get('username'), f.get('password'));
      else await register({ username: f.get('username'), password: f.get('password'), displayName: f.get('displayName') || undefined, inviteCode: f.get('inviteCode') || undefined });
      closeDialog();
      toast(t(mode === 'login' ? 'auth.welcomeBack' : 'auth.welcome'));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return html`<${Modal} title=${t(mode === 'login' ? 'auth.signIn' : 'auth.createAccount')} onClose=${closeDialog}>
    ${reason ? html`<p class="muted" style="margin-bottom:12px">${t(`auth.reason.${reason}`)}</p>` : null}
    ${config.needsSetup ? html`<div class="notice" style="margin-bottom:14px">${t('auth.firstUser')}</div>` : null}
    <form onSubmit=${submit} class="stack" style="gap:0">
      <div class="field"><label for="a-user">${t('auth.username')}</label>
        <input id="a-user" name="username" class="input" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" autocapitalize="none" spellcheck="false" />
        ${mode === 'register' ? html`<span class="hint">${t('auth.usernameHint')}</span>` : null}</div>
      ${mode === 'register' ? html`<div class="field"><label for="a-name">${t('auth.displayName')}</label>
        <input id="a-name" name="displayName" class="input" maxlength="40" autocomplete="nickname" /></div>` : null}
      <div class="field"><label for="a-pass">${t('auth.password')}</label>
        <input id="a-pass" name="password" type="password" class="input" required minlength=${mode === 'register' ? 8 : 1} maxlength="200" autocomplete=${mode === 'login' ? 'current-password' : 'new-password'} />
        ${mode === 'register' ? html`<span class="hint">${t('auth.passwordHint')}</span>` : null}</div>
      ${mode === 'register' && config.registration === 'invite' && !config.needsSetup ? html`<div class="field"><label for="a-invite">${t('auth.inviteCode')}</label>
        <input id="a-invite" name="inviteCode" class="input" required autocomplete="off" /></div>` : null}
      <${FormError} error=${error} />
      <div class="modal-foot" style="justify-content:space-between;align-items:center">
        ${canRegister ? html`<button type="button" class="btn ghost sm" onClick=${() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          ${mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}</button>` : html`<span class="faint">${t('auth.closed')}</span>`}
        <button class="btn primary" type="submit" disabled=${busy}>${mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}</button>
      </div>
    </form>
  <//>`;
}

/* ---- upload ------------------------------------------------------------------- */
function UploadDialog() {
  useLang();
  const { config } = useSession();
  const [file, setFile] = useState(null);
  const [cover, setCover] = useState(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const genres = useAsync(() => api('/genres'), []);
  const input = useRef(null);
  const maxBytes = config.maxUploadMb * 1024 * 1024;

  const pick = (f) => {
    if (!f) return;
    setError('');
    if (f.size > maxBytes) { setError(t('upload.tooBig', { mb: config.maxUploadMb })); return; }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError(t('upload.chooseFile')); return; }
    const f = new FormData(e.target);
    f.delete('audio');
    f.set('confirmAi', f.get('confirmAi') ? 'true' : 'false');
    f.append('audio', file, file.name);
    if (cover) f.append('cover', cover, cover.name);
    setError('');
    setProgress(0);
    try {
      const track = await uploadForm('/tracks', f, { onProgress: (p) => setProgress(p) });
      closeDialog();
      toast(track.status === 'pending' ? t('upload.pending') : t('upload.done'));
      navigate(`/t/${track.id}`);
    } catch (err) {
      setError(errorText(err));
      setProgress(null);
    }
  };

  const uploading = progress !== null;
  return html`<${Modal} title=${t('upload.title')} onClose=${uploading ? () => {} : closeDialog}>
    <form onSubmit=${submit}>
      <div class="field">
        <span class="label">${t('upload.audio')}</span>
        <label class=${`dropzone${over ? ' over' : ''}`} onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
          onDrop=${(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}>
          <input ref=${input} type="file" accept="audio/*,video/mp4,.m4a,.flac,.ogg,.opus,.wav,.mp3,.aac" class="sr-only" data-testid="audio-input"
            onChange=${(e) => pick(e.target.files[0])} />
          ${file ? html`<strong>${file.name}</strong><div class="faint">${fmtBytes(file.size)}</div>` : html`<${Icon} name="upload" size=${28} /><div>${t('upload.drop')}</div><div class="faint">${t('upload.formats', { mb: config.maxUploadMb, min: config.maxTrackMinutes })}</div>`}
        </label>
      </div>
      <div class="field"><label for="u-title">${t('upload.trackTitle')}</label>
        <input id="u-title" name="title" class="input" required maxlength="120" value=${title} onInput=${(e) => setTitle(e.target.value)} /></div>
      <div class="row wrap" style="align-items:flex-start">
        <div class="field grow" style="min-width:150px"><label for="u-genre">${t('upload.genre')}</label>
          <input id="u-genre" name="genre" class="input" maxlength="40" list="genre-list" autocomplete="off" />
          <datalist id="genre-list">${(genres.data?.items || []).map((g) => html`<option value=${g.name}></option>`)}</datalist></div>
        <div class="field grow" style="min-width:150px"><label for="u-model">${t('upload.model')}</label>
          <input id="u-model" name="model" class="input" maxlength="60" placeholder="Suno, Udio, MusicGen…" /></div>
      </div>
      <div class="field"><label for="u-prompt">${t('upload.prompt')}</label>
        <textarea id="u-prompt" name="prompt" class="textarea" required minlength="3" maxlength="2000"></textarea>
        <span class="hint">${t('upload.promptHint')}</span></div>
      <div class="field"><label for="u-lyrics">${t('upload.lyrics')}</label>
        <textarea id="u-lyrics" name="lyrics" class="textarea" maxlength="10000"></textarea></div>
      <div class="row wrap" style="align-items:flex-start">
        <div class="field grow" style="min-width:180px"><label for="u-license">${t('upload.license')}</label>
          <select id="u-license" name="license" class="select">
            <option value="non_commercial">${t('license.non_commercial')}</option>
            <option value="commercial">${t('license.commercial')}</option>
          </select><span class="hint">${t('upload.licenseHint')}</span></div>
        <div class="field grow" style="min-width:180px"><label for="u-cover">${t('upload.cover')}</label>
          <input id="u-cover" type="file" class="input" accept="image/png,image/jpeg,image/webp,image/gif" data-testid="cover-input"
            onChange=${(e) => setCover(e.target.files[0] || null)} /></div>
      </div>
      <div class="field"><label class="check"><input type="checkbox" name="confirmAi" required data-testid="confirm-ai" /><span>${t('upload.confirm')}</span></label></div>
      ${config.requireApproval ? html`<p class="faint" style="margin-bottom:10px">${t('upload.approvalNote')}</p>` : null}
      ${uploading ? html`<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(progress * 100)} aria-label=${t('upload.uploading')}><i style=${`width:${Math.round(progress * 100)}%`}></i></div>
        <p class="faint" style="margin-top:6px">${progress >= 1 ? t('upload.processing') : t('upload.uploading')}</p>` : null}
      <${FormError} error=${error} />
      <div class="modal-foot">
        <button type="button" class="btn" disabled=${uploading} onClick=${closeDialog}>${t('common.cancel')}</button>
        <button type="submit" class="btn primary" disabled=${uploading}>${t('upload.publish')}</button>
      </div>
    </form>
  <//>`;
}

/* ---- edit / delete track --------------------------------------------------------- */
function EditTrackDialog({ track, onSaved }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/tracks/${track.id}`).then(setDetail).catch((e) => setError(errorText(e))); }, [track.id]);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setBusy(true);
    try {
      const updated = await api(`/tracks/${track.id}`, { method: 'PATCH', body: f });
      patchOverride(track.id, { title: updated.title, genre: updated.genre, license: updated.license });
      closeDialog();
      toast(t('common.saved'));
      invalidate();
      onSaved?.(updated);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  const removeCover = async () => {
    try { await api(`/tracks/${track.id}/cover`, { method: 'DELETE' }); toast(t('common.saved')); invalidate(); closeDialog(); } catch (err) { setError(errorText(err)); }
  };
  const replaceCover = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append('cover', file, file.name);
    try { await uploadForm(`/tracks/${track.id}/cover`, form, { method: 'PUT' }); toast(t('common.saved')); invalidate(); closeDialog(); } catch (err) { setError(errorText(err)); }
  };
  return html`<${Modal} title=${t('track.edit')} onClose=${closeDialog}>
    ${!detail ? (error ? html`<${FormError} error=${error} />` : html`<${Spinner} />`) : html`
    <form onSubmit=${submit}>
      <div class="field"><label for="e-title">${t('upload.trackTitle')}</label><input id="e-title" name="title" class="input" required maxlength="120" value=${detail.title} /></div>
      <div class="row wrap" style="align-items:flex-start">
        <div class="field grow"><label for="e-genre">${t('upload.genre')}</label><input id="e-genre" name="genre" class="input" maxlength="40" value=${detail.genre} /></div>
        <div class="field grow"><label for="e-model">${t('upload.model')}</label><input id="e-model" name="model" class="input" maxlength="60" value=${detail.model} /></div>
      </div>
      <div class="field"><label for="e-prompt">${t('upload.prompt')}</label><textarea id="e-prompt" name="prompt" class="textarea" required minlength="3" maxlength="2000">${detail.prompt}</textarea></div>
      <div class="field"><label for="e-lyrics">${t('upload.lyrics')}</label><textarea id="e-lyrics" name="lyrics" class="textarea" maxlength="10000">${detail.lyrics}</textarea></div>
      <div class="field"><label for="e-license">${t('upload.license')}</label>
        <select id="e-license" name="license" class="select">
          <option value="non_commercial" selected=${detail.license === 'non_commercial'}>${t('license.non_commercial')}</option>
          <option value="commercial" selected=${detail.license === 'commercial'}>${t('license.commercial')}</option>
        </select></div>
      <div class="field"><span class="label">${t('upload.cover')}</span>
        <div class="row wrap">
          <label class="btn sm">${t('edit.replaceCover')}<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp,image/gif" onChange=${(e) => replaceCover(e.target.files[0])} /></label>
          ${detail.hasCover ? html`<button type="button" class="btn sm danger" onClick=${removeCover}>${t('edit.removeCover')}</button>` : null}
        </div></div>
      <${FormError} error=${error} />
      <div class="modal-foot"><button type="button" class="btn" onClick=${closeDialog}>${t('common.cancel')}</button>
        <button type="submit" class="btn primary" disabled=${busy}>${t('common.save')}</button></div>
    </form>`}
  <//>`;
}

function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    try { await onConfirm(); closeDialog(); } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  return html`<${Modal} title=${title} onClose=${closeDialog}>
    <p>${message}</p><${FormError} error=${error} />
    <div class="modal-foot"><button type="button" class="btn" onClick=${closeDialog}>${t('common.cancel')}</button>
      <button type="button" class=${`btn ${danger ? 'danger' : 'primary'}`} disabled=${busy} onClick=${go} data-testid="confirm-yes">${confirmLabel}</button></div>
  <//>`;
}

function DeleteTrackDialog({ track, onDeleted }) {
  return html`<${ConfirmDialog} title=${t('track.delete')} message=${t('track.deleteConfirm', { title: track.title })}
    confirmLabel=${t('track.delete')} danger=${true}
    onConfirm=${async () => { await api(`/tracks/${track.id}`, { method: 'DELETE' }); markDeleted(track.id); toast(t('track.deleted')); onDeleted?.(); }} />`;
}

/* ---- report ------------------------------------------------------------------------ */
const REASONS = ['copyright', 'voice_imitation', 'not_ai', 'abuse', 'other'];
function ReportDialog({ track }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setBusy(true);
    try {
      await api(`/tracks/${track.id}/report`, { method: 'POST', body: f });
      closeDialog();
      toast(t('report.sent'));
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return html`<${Modal} title=${t('report.title')} onClose=${closeDialog}>
    <p class="muted" style="margin-bottom:14px">${t('report.intro', { title: track.title })}</p>
    <form onSubmit=${submit}>
      <div class="field"><label for="r-reason">${t('report.reason')}</label>
        <select id="r-reason" name="reason" class="select" required>${REASONS.map((r) => html`<option value=${r}>${t(`report.reason.${r}`)}</option>`)}</select></div>
      <div class="field"><label for="r-details">${t('report.details')}</label><textarea id="r-details" name="details" class="textarea" maxlength="1000"></textarea></div>
      <div class="field"><label for="r-contact">${t('report.contact')}</label><input id="r-contact" name="contact" class="input" maxlength="200" autocomplete="email" />
        <span class="hint">${t('report.contactHint')}</span></div>
      <${FormError} error=${error} />
      <div class="modal-foot"><button type="button" class="btn" onClick=${closeDialog}>${t('common.cancel')}</button>
        <button class="btn primary" type="submit" disabled=${busy}>${t('report.send')}</button></div>
    </form>
  <//>`;
}

/* ---- moderator removal with a reason shown to the uploader ------------------------------- */
function RemoveTrackDialog({ track, onConfirm }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const reason = new FormData(e.target).get('reason');
    setBusy(true);
    try { await onConfirm(String(reason || '').trim()); closeDialog(); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return html`<${Modal} title=${t('remove.title')} onClose=${closeDialog}>
    <p class="muted" style="margin-bottom:14px">${t('remove.intro', { title: track.title })}</p>
    <form onSubmit=${submit}>
      <div class="field"><label for="rm-reason">${t('remove.reason')}</label>
        <textarea id="rm-reason" name="reason" class="textarea" maxlength="500" required></textarea>
        <span class="hint">${t('remove.reasonHint')}</span></div>
      <${FormError} error=${error} />
      <div class="modal-foot"><button type="button" class="btn" onClick=${closeDialog}>${t('common.cancel')}</button>
        <button class="btn danger" type="submit" disabled=${busy}>${t('remove.confirm')}</button></div>
    </form>
  <//>`;
}

/* ---- playlists --------------------------------------------------------------------- */
function PlaylistPickerDialog({ track }) {
  const lists = useAsync(() => api('/playlists'), []);
  const [error, setError] = useState('');
  const add = async (pl) => {
    try {
      await api(`/playlists/${pl.id}/tracks`, { method: 'POST', body: { trackId: track.id } });
      closeDialog();
      toast(t('playlist.added', { name: pl.name }));
    } catch (err) { setError(errorText(err)); }
  };
  const create = async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    try {
      const pl = await api('/playlists', { method: 'POST', body: { name } });
      await add(pl);
    } catch (err) { setError(errorText(err)); }
  };
  return html`<${Modal} title=${t('track.addToPlaylist')} onClose=${closeDialog}>
    ${lists.loading ? html`<${Spinner} />` : lists.error ? html`<${Failed} onRetry=${lists.reload} />` : html`
      <ul class="stack" style="gap:6px;margin-bottom:16px" aria-label=${t('library.playlists')}>
        ${lists.data.items.map((pl) => html`<li key=${pl.id}><button type="button" class="btn" style="width:100%;justify-content:space-between" onClick=${() => add(pl)}>
          <span class="clamp">${pl.name}</span><span class="faint">${tn('count.tracks', pl.tracks)}</span></button></li>`)}
      </ul>
      <form onSubmit=${create} class="row">
        <input name="name" class="input" required maxlength="80" placeholder=${t('playlist.newName')} aria-label=${t('playlist.newName')} />
        <button class="btn primary" type="submit">${t('playlist.create')}</button>
      </form>`}
    <${FormError} error=${error} />
  <//>`;
}

function PlaylistFormDialog({ playlist, onSaved }) {
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = { name: f.get('name'), description: f.get('description'), isPublic: !!f.get('isPublic') };
    try {
      const pl = playlist ? await api(`/playlists/${playlist.id}`, { method: 'PATCH', body }) : await api('/playlists', { method: 'POST', body });
      closeDialog();
      onSaved?.(pl);
    } catch (err) { setError(errorText(err)); }
  };
  return html`<${Modal} title=${t(playlist ? 'playlist.edit' : 'playlist.new')} onClose=${closeDialog}>
    <form onSubmit=${submit}>
      <div class="field"><label for="p-name">${t('playlist.name')}</label><input id="p-name" name="name" class="input" required maxlength="80" value=${playlist?.name || ''} /></div>
      <div class="field"><label for="p-desc">${t('playlist.description')}</label><textarea id="p-desc" name="description" class="textarea" maxlength="500">${playlist?.description || ''}</textarea></div>
      <div class="field"><label class="check"><input type="checkbox" name="isPublic" checked=${!!playlist?.isPublic} /><span>${t('playlist.public')}</span></label></div>
      <${FormError} error=${error} />
      <div class="modal-foot"><button type="button" class="btn" onClick=${closeDialog}>${t('common.cancel')}</button>
        <button class="btn primary" type="submit">${t('common.save')}</button></div>
    </form>
  <//>`;
}

function DeleteAccountDialog() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/me/delete', { method: 'POST', body: { password: new FormData(e.target).get('password') } });
      await refreshSession();
      closeDialog();
      navigate('/');
      toast(t('settings.accountDeleted'));
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return html`<${Modal} title=${t('settings.deleteAccount')} onClose=${closeDialog}>
    <p class="muted" style="margin-bottom:14px">${t('settings.deleteWarning')}</p>
    <form onSubmit=${submit}>
      <div class="field"><label for="d-pass">${t('auth.password')}</label><input id="d-pass" name="password" type="password" class="input" required autocomplete="current-password" /></div>
      <${FormError} error=${error} />
      <div class="modal-foot"><button type="button" class="btn" onClick=${closeDialog}>${t('common.cancel')}</button>
        <button class="btn danger" type="submit" disabled=${busy}>${t('settings.deleteAccount')}</button></div>
    </form>
  <//>`;
}

export { ConfirmDialog };

export function DialogHost() {
  useLang();
  const { dialog } = useStore(ui);
  if (!dialog) return null;
  const { type, props } = dialog;
  switch (type) {
    case 'auth': return html`<${AuthDialog} ...${props} />`;
    case 'upload': return html`<${UploadDialog} />`;
    case 'edit-track': return html`<${EditTrackDialog} ...${props} />`;
    case 'delete-track': return html`<${DeleteTrackDialog} ...${props} />`;
    case 'report': return html`<${ReportDialog} ...${props} />`;
    case 'remove-track': return html`<${RemoveTrackDialog} ...${props} />`;
    case 'playlist-picker': return html`<${PlaylistPickerDialog} ...${props} />`;
    case 'playlist-form': return html`<${PlaylistFormDialog} ...${props} />`;
    case 'delete-account': return html`<${DeleteAccountDialog} />`;
    case 'confirm': return html`<${ConfirmDialog} ...${props} />`;
    default: return null;
  }
}
