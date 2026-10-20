// Interface translations: t('key', { param }) looks up the current language's dictionary.
// A value can be a plural object ({ one, few, many, other }) selected by params.n.
// Static texts in index.html are marked with data-i18n, data-i18n-title, data-i18n-placeholder
// and data-i18n-aria-label attributes and filled in by translateDom().

import uk from './locales/uk.json' with { type: 'json' };

const DICTS = { uk };
const LOCALES = { uk: 'uk-UA' };

let lang = 'uk';
let dict = uk;
let pluralRules = new Intl.PluralRules(LOCALES[lang]);

export const getLanguage = () => lang;

// Locale for dates, times and sorting
export const locale = () => LOCALES[lang];

export function setLanguage(code) {
  lang = DICTS[code] ? code : 'uk';
  dict = DICTS[lang];
  pluralRules = new Intl.PluralRules(LOCALES[lang]);
  document.documentElement.lang = lang;
}

export function t(key, params = {}) {
  let text = dict[key] ?? uk[key];
  if (text === undefined) {
    console.warn('Missing translation:', key);
    return key;
  }
  if (typeof text === 'object') text = text[pluralRules.select(params.n ?? 0)] ?? text.other;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// Like t(), but {name} placeholders whose params are DOM nodes become those nodes:
// returns an array of strings and nodes for h() / append()
export function tNodes(key, params = {}) {
  const strings = Object.fromEntries(Object.entries(params).filter(([, v]) => !(v instanceof Node)));
  return t(key, strings).split(/(\{\w+\})/).map((part) => {
    const node = params[part.slice(1, -1)];
    return part.startsWith('{') && node instanceof Node ? node : part;
  }).filter((part) => part !== '');
}

export function translateDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
}
