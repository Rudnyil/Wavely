import { html, Icon, api, createStore } from '../lib.js';
import { t, useLang, errorText, LANGUAGES, setLang, getLang } from '../i18n.js';
import { Empty, FormError } from '../components/common.js';
import { useSession, openDialog, logout, refreshSession } from '../session.js';
import { getTheme, setTheme } from '../theme.js';
import { navigate } from '../router.js';
import { toast } from '../toast.js';
import { usePageTitle } from './util.js';
import { useState } from 'preact/hooks';

export function SettingsPage() {
  useLang();
  usePageTitle(t('nav.settings'));
  const { user } = useSession();
  const [theme, setThemeState] = useState(getTheme());
  const [profileErr, setProfileErr] = useState('');
  const [passErr, setPassErr] = useState('');

  if (!user) return html`<div class="page"><${Empty} icon="settings" title=${t('settings.signIn')}><button class="btn primary" onClick=${() => openDialog('auth')}>${t('auth.signIn')}</button><//></div>`;

  const saveProfile = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setProfileErr('');
    try { await api('/me', { method: 'PATCH', body: { displayName: f.get('displayName'), bio: f.get('bio') } }); await refreshSession(); toast(t('common.saved')); }
    catch (err) { setProfileErr(errorText(err)); }
  };
  const changePassword = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setPassErr('');
    try { await api('/me/password', { method: 'POST', body: { current: f.get('current'), next: f.get('next') } }); e.target.reset(); toast(t('settings.passwordChanged')); }
    catch (err) { setPassErr(errorText(err)); }
  };
  const deleteAccount = () => openDialog('delete-account');
  const pickTheme = (v) => { setTheme(v); setThemeState(v); };

  return html`<div class="page" style="max-width:760px">
    <h1 style="margin-bottom:20px">${t('nav.settings')}</h1>

    <section class="panel" aria-labelledby="s-profile"><h2 id="s-profile" style="margin-bottom:14px">${t('settings.profile')}</h2>
      <form onSubmit=${saveProfile}>
        <div class="field"><label for="s-name">${t('auth.displayName')}</label><input id="s-name" name="displayName" class="input" maxlength="40" required value=${user.displayName} /></div>
        <div class="field"><label for="s-bio">${t('settings.bio')}</label><textarea id="s-bio" name="bio" class="textarea" maxlength="500">${user.bio}</textarea></div>
        <p class="faint" style="margin-bottom:10px">${t('settings.username')}: <span class="mono">@${user.username}</span></p>
        <${FormError} error=${profileErr} />
        <button class="btn primary" type="submit">${t('common.save')}</button>
      </form></section>

    <section class="panel" style="margin-top:18px" aria-labelledby="s-look"><h2 id="s-look" style="margin-bottom:14px">${t('settings.appearance')}</h2>
      <div class="field"><span class="label" id="theme-label">${t('settings.theme')}</span>
        <div class="chips" role="group" aria-labelledby="theme-label">
          ${['system', 'dark', 'light'].map((v) => html`<button type="button" class="chip" aria-pressed=${theme === v} onClick=${() => pickTheme(v)}>${t(`settings.theme.${v}`)}</button>`)}
        </div></div>
      <div class="field" style="margin-bottom:0"><span class="label" id="lang-label">${t('settings.language')}</span>
        <div class="chips" role="group" aria-labelledby="lang-label">
          ${LANGUAGES.map(([code, name]) => html`<button type="button" class="chip" lang=${code} aria-pressed=${getLang() === code} onClick=${() => setLang(code)}>${name}</button>`)}
        </div></div></section>

    <section class="panel" style="margin-top:18px" aria-labelledby="s-pass"><h2 id="s-pass" style="margin-bottom:14px">${t('settings.password')}</h2>
      <form onSubmit=${changePassword}>
        <div class="field"><label for="s-cur">${t('settings.currentPassword')}</label><input id="s-cur" name="current" type="password" class="input" required autocomplete="current-password" /></div>
        <div class="field"><label for="s-new">${t('settings.newPassword')}</label><input id="s-new" name="next" type="password" class="input" required minlength="8" maxlength="200" autocomplete="new-password" />
          <span class="hint">${t('auth.passwordHint')}</span></div>
        <${FormError} error=${passErr} />
        <button class="btn" type="submit">${t('settings.changePassword')}</button>
      </form></section>

    <section class="panel" style="margin-top:18px" aria-labelledby="s-data"><h2 id="s-data" style="margin-bottom:8px">${t('settings.data')}</h2>
      <p class="muted" style="margin-bottom:14px">${t('settings.dataHint')}</p>
      <div class="row wrap">
        <a class="btn" href="/api/me/export" download=${`wavely-${user.username}.json`}><${Icon} name="download" />${t('settings.export')}</a>
        <button class="btn" onClick=${async () => { await logout(); navigate('/'); toast(t('auth.signedOut')); }}><${Icon} name="logout" />${t('auth.signOut')}</button>
        <button class="btn danger" onClick=${deleteAccount}><${Icon} name="trash" />${t('settings.deleteAccount')}</button>
      </div></section>
  </div>`;
}
