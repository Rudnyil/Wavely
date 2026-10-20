import { createStore, storage, useStore } from './lib.js';
import en from './locales/en.js';
import uk from './locales/uk.js';

const LOCALES = { en, uk };
export const LANGUAGES = [['en', 'English'], ['uk', 'Українська']];

function detect() {
  const saved = storage.get('lang');
  if (saved && LOCALES[saved]) return saved;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return nav.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

export const langStore = createStore({ lang: detect() });
export const getLang = () => langStore.get().lang;

export function setLang(lang) {
  if (!LOCALES[lang]) return;
  storage.set('lang', lang);
  document.documentElement.lang = lang;
  langStore.set({ lang });
}
document.documentElement.lang = getLang();

function interpolate(str, params) {
  return params ? str.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? `{${k}}`)) : str;
}

/** Translate a key; falls back to English, then to the key itself. */
export function t(key, params) {
  const lang = getLang();
  const str = LOCALES[lang][key] ?? en[key] ?? key;
  return interpolate(str, params);
}

/** Plural-aware translate: looks up key.one / key.few / key.many / key.other using the locale's rules. */
export function tn(key, count, params = {}) {
  const lang = getLang();
  const form = new Intl.PluralRules(lang).select(count);
  const dict = LOCALES[lang];
  const str = dict[`${key}.${form}`] ?? dict[`${key}.other`] ?? en[`${key}.${form}`] ?? en[`${key}.other`] ?? key;
  return interpolate(str, { count: new Intl.NumberFormat(lang).format(count), ...params });
}

/** Hook that re-renders the component when the language changes. */
export function useLang() {
  return useStore(langStore, (s) => s.lang);
}

/** Error code → localized message, falling back to the server text. */
export function errorText(err) {
  const key = `err.${err.code}`;
  const dict = LOCALES[getLang()];
  if (dict[key] || en[key]) return t(key);
  if (err.code === 'network') return t('err.network');
  return err.message || t('err.generic');
}
