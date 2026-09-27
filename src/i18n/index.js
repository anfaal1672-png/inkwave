// INKWAVE — UI language.
//   tr('Low ink!')               → the string in the current language (English is the key and the fallback)
//   tr('{n} SEC', { n: 90 })     → placeholders are {name}; the translation may move them around
//   (named tr, not t: plenty of UI code already uses t for time)
//   N_('Swim fast')              → marks a string for translation where it is defined (data tables); returns it as-is
//   setLang('ja' | 'en') · getLang() · onLang(fn) → unsubscribe · relabel(root)
//
// The source strings stay in English exactly where they were written, so nothing else needs a lookup table and a
// missing translation simply shows the English. tools/i18n-check.mjs lists strings that have no Japanese entry.
//
// Static text that is built once and stays on screen (HUD labels, the map legend) opts into live switching with
// label(key[, rich]): an attribute bag for h() that relabel() uses to rewrite the node when the language changes.
// Menu screens are rebuilt on show, so they only need tr().
import { JA } from './ja.js';

export const LANGS = [['ja', '日本語'], ['en', 'English']];
const DICTS = { ja: JA };
const listeners = new Set();
let lang = 'ja';
let missing = null;   // ?i18n=debug: untranslated strings seen at runtime (window.__i18nMissing)

function initial() {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('i18n') === 'debug') { missing = new Set(); window.__i18nMissing = missing; }
    const forced = q.get('lang');
    if (forced) return forced;
    const s = JSON.parse(localStorage.getItem('inkwave.settings'));
    if (s && s.lang) return s.lang;
  } catch { /* no storage / not a browser */ }
  return 'ja';
}

export function getLang() { return lang; }

export function setLang(l) {
  const next = l === 'en' || DICTS[l] ? l : 'ja';
  const changed = next !== lang;
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (changed) for (const fn of listeners) { try { fn(lang); } catch (e) { console.error('[i18n]', e); } }
}

export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function tr(s, params) {
  if (s == null) return '';
  s = String(s);
  let out = s;
  if (lang !== 'en') {
    const hit = DICTS[lang][s];
    if (hit !== undefined) out = hit;
    else if (missing && /[A-Za-z]{2}/.test(s)) missing.add(s);
  }
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return out;
}

export const N_ = (s) => s;

// Attributes for a node whose whole text is one translatable string: h('div', { class: 'x', ...label('LOW INK') }, tr('LOW INK')).
// rich = the string goes through richText() (key caps like [TAB]) and is set as HTML.
export function label(key, rich = false) {
  return rich ? { 'data-i18n-rich': key } : { 'data-i18n': key };
}

let richFn = null;
export function setRichText(fn) { richFn = fn; }

export function relabel(root) {
  if (!root || !root.querySelectorAll) return;
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = tr(n.getAttribute('data-i18n'));
  if (richFn) for (const n of root.querySelectorAll('[data-i18n-rich]')) n.innerHTML = richFn(tr(n.getAttribute('data-i18n-rich')));
}

setLang(initial());
