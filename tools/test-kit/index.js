'use strict';
// Helpers for the autotest scenarios. tools/autotest.js passes them to every scenario together with
// the basic ones (exec, waitFor, wait, shot, resize, click, log).
//
// Core (this file):
//   step(name, fn)            a small named part of a scenario; an error fails that step only
//   act(text)                 writes an action to the log ("→ press Ctrl+D"); every helper action does it
//   check(name, ok, detail)   records a result; autotest.js prints the summary and sets the exit code
//   skip(reason)              notes something that can't be checked here (a missing optional book)
//   book(role) / has(role)    a test book by role (tools/test-books.json) / whether it's available
//   facts                     what the generated books contain (tools/fixtures/facts.json)
//   t(key, params)            the interface text in the language the tests run in (locales/*.json)
//   press(key, modifiers)     a key press as the window receives it
// By topic (one file each, see their headers):
//   reader, sidePanel, bookmarks, readingSettings, appPanel, highlights
// Older scenarios also use open(), tocItem(), pagesReady() and location() directly.

const path = require('node:path');
const fs = require('node:fs');

const TOOLS = path.resolve(__dirname, '..');
const ROOT = path.resolve(TOOLS, '..');
const BOOKS = require('../test-books.json');
const FIXTURES = path.join(TOOLS, 'fixtures');
// Optional real books: samples/ unless CHYTALKA_SAMPLES_DIR points elsewhere
const SAMPLES_DIR = process.env.CHYTALKA_SAMPLES_DIR || path.join(ROOT, 'samples');
const LOCALES = { uk: 'uk-UA', en: 'en-GB' };

// The interface language of a test run: Ukrainian unless CHYTALKA_TEST_LANG says otherwise
const LANG = process.env.CHYTALKA_TEST_LANG || 'uk';

function loadDictionary(lang) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'locales', `${lang}.json`), 'utf8'));
}

// The same lookup as src/renderer/i18n.js: plural objects are picked by params.n
function translator(lang) {
  const dict = loadDictionary(lang);
  const plural = new Intl.PluralRules(LOCALES[lang]);
  return (key, params = {}) => {
    let text = dict[key];
    if (text === undefined) throw new Error(`No translation for "${key}"`);
    if (typeof text === 'object') text = text[plural.select(params.n ?? 0)] ?? text.other;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
}

// KeyboardEvent.code for the keys the app checks by code (Ctrl+= and friends)
function keyCode(key) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return { '=': 'Equal', '+': 'Equal', '-': 'Minus' }[key] ?? key;
}

function keyName(key, { ctrl, shift }) {
  return [ctrl && 'Ctrl', shift && 'Shift', key.length === 1 ? key.toUpperCase() : key].filter(Boolean).join('+');
}

function bookPath(role) {
  const entry = BOOKS[role];
  if (!entry || role.startsWith('_')) throw new Error(`Unknown book role "${role}" (see tools/test-books.json)`);
  return entry.fixture ? path.join(FIXTURES, entry.fixture) : path.join(SAMPLES_DIR, entry.sample);
}

function createKit(base) {
  const { exec, log } = base;
  const results = [];
  const skipped = [];

  function check(name, ok, detail = '') {
    results.push({ name, ok: !!ok });
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    return !!ok;
  }

  function skip(reason) {
    skipped.push(reason);
    log(`SKIP ${reason}`);
  }

  const act = (text) => log(`→ ${text}`);

  // A named part of a scenario. If it throws, that's one failed check and the scenario goes on.
  async function step(name, fn) {
    log(`STEP ${name}`);
    try {
      await fn(kit);
    } catch (err) {
      check(`${name}: ${err.message}`, false);
    }
  }

  const has = (role) => fs.existsSync(bookPath(role));

  function book(role) {
    const file = bookPath(role);
    if (!fs.existsSync(file)) {
      const entry = BOOKS[role];
      throw new Error(entry.fixture
        ? `Generated book ${entry.fixture} is missing: run npm run fixtures`
        : `Optional book for "${role}" not found: samples/${entry.sample} (${entry.about}); check has('${role}') first`);
    }
    return file;
  }

  function press(key, { ctrl = false, shift = false, code = keyCode(key), quiet = false } = {}) {
    if (!quiet) act(`press ${keyName(key, { ctrl, shift })}`);
    return exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true }))`);
  }

  const kit = {
    ...base,
    lang: LANG,
    t: translator(LANG),
    translator,
    check,
    skip,
    step,
    act,
    book,
    has,
    facts: JSON.parse(fs.readFileSync(path.join(FIXTURES, 'facts.json'), 'utf8')),
    press,
    results,
    skipped,
  };

  // Helpers by topic; each gets the kit and adds itself to it
  kit.reader = require('./reader')(kit);
  kit.sidePanel = require('./side-panel')(kit);
  kit.bookmarks = require('./bookmarks')(kit);
  kit.readingSettings = require('./panels').readingSettings(kit);
  kit.appPanel = require('./panels').appPanel(kit);
  kit.highlights = require('./highlights')(kit);

  // Short names the older scenarios use
  kit.open = (role, options) => kit.reader.open(role, options);
  kit.tocItem = (index) => kit.reader.goToContentsItem(index, { settle: 0 });
  kit.pagesReady = (timeout) => kit.reader.pagesReady(timeout);
  kit.location = () => kit.reader.location();
  return kit;
}

module.exports = { createKit, LANG, ROOT };
