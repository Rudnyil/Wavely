import { api, createStore, useStore } from './lib.js';
import { dropTrack } from './player.js';

export const session = createStore({ ready: false, user: null, config: null });
export const useSession = () => useStore(session);

export async function refreshSession() {
  const [me, config] = await Promise.all([api('/me'), api('/config')]);
  session.set({ ready: true, user: me.user, config });
}

export async function refreshConfig() {
  session.set({ config: await api('/config') });
}

export async function login(username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  await refreshSession();
  return r.user;
}

export async function register(body) {
  const r = await api('/auth/register', { method: 'POST', body });
  await refreshSession();
  return r.user;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST', body: {} });
  await refreshSession();
}

export const isModerator = (u) => !!u && (u.role === 'moderator' || u.role === 'admin');

/* ---- dialogs ---------------------------------------------------------------- */
export const ui = createStore({ dialog: null, sheet: false, sheetTab: 'now' });
export const openDialog = (type, props = {}) => ui.set({ dialog: { type, props } });
export const closeDialog = () => ui.set({ dialog: null });
export const requireLogin = (reason) => {
  if (session.get().user) return true;
  openDialog('auth', { reason });
  return false;
};

/* ---- shared track state (likes, deletions) ----------------------------------------- */
export const overrides = createStore({ map: {} });

export function patchOverride(id, patch) {
  overrides.set((s) => ({ map: { ...s.map, [id]: { ...s.map[id], ...patch } } }));
}

export function withOverride(track) {
  const o = overrides.get().map[track.id];
  return o ? { ...track, ...o } : track;
}

export function useOverrides() { return useStore(overrides); }

export async function toggleLike(track, patchPlayer) {
  if (!requireLogin('like')) return;
  const t = withOverride(track);
  const liked = !t.liked;
  const likes = Math.max(0, t.likes + (liked ? 1 : -1));
  patchOverride(track.id, { liked, likes });
  patchPlayer?.(track.id, { liked, likes });
  try {
    const r = await api(`/tracks/${track.id}/like`, { method: liked ? 'PUT' : 'DELETE' });
    patchOverride(track.id, { likes: r.likes });
  } catch (e) {
    patchOverride(track.id, { liked: t.liked, likes: t.likes });
    throw e;
  }
}

export function markDeleted(id) {
  patchOverride(id, { deleted: true });
  dropTrack(id);
}

/* ---- cache-busting counter: bump after edits so open pages reload their data ------------- */
export const dataVersion = createStore({ n: 0 });
export const invalidate = () => dataVersion.set((s) => ({ n: s.n + 1 }));
export const useDataVersion = () => useStore(dataVersion, (s) => s.n);
