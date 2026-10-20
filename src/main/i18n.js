'use strict';
// Translations for the main process (native dialogs). Uses the same dictionaries as the window.

const uk = require('../renderer/locales/uk.json');

const dict = uk;

function t(key, params = {}) {
  const text = dict[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

module.exports = { t };
