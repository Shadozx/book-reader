'use strict';
// Translations for the main process (native dialogs). Uses the same dictionaries as the window.

const { app } = require('electron');

const DICTS = {
  uk: require('../renderer/locales/uk.json'),
  en: require('../renderer/locales/en.json'),
};

let dict = DICTS.uk;

// The setting is 'uk', 'en' or 'auto'. "Auto" takes the first language from the Windows
// language list (not the Windows display language): Ukrainian if it's Ukrainian, English otherwise.
// CHYTALKA_SYSTEM_LANG replaces the system language for autotests.
function resolveLanguage(setting) {
  if (DICTS[setting]) return setting;
  const system = process.env.CHYTALKA_SYSTEM_LANG ?? app.getPreferredSystemLanguages()[0] ?? app.getLocale();
  return system.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

// Returns the language actually used
function setLanguage(setting) {
  const lang = resolveLanguage(setting);
  dict = DICTS[lang];
  return lang;
}

function t(key, params = {}) {
  const text = dict[key] ?? DICTS.uk[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

module.exports = { t, setLanguage };
