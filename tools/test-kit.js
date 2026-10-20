'use strict';
// Helpers shared by the autotest scenarios. tools/autotest.js passes them to every scenario
// together with the basic ones (exec, waitFor, wait, shot, resize, click, log).
//
//   check(name, ok, detail)   records a result; autotest.js prints the summary and sets the exit code
//   sample(role)              path to a sample book by role (tools/samples.json)
//   open(role)                opens a sample book and waits until it's shown
//   t(key, params)            the interface text in the language the tests run in (locales/*.json)
//   press(key, modifiers)     a key press as the window receives it
//   tocItem(index)            jumps to a table of contents entry, like a click in the side panel
//   pagesReady()              waits until the visible PDF/DjVu pages are drawn
//   location()                the current reading position of the active tab

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const SAMPLES = require('./samples.json');
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

function createKit({ exec, waitFor, wait, log }) {
  const results = [];

  function check(name, ok, detail = '') {
    results.push({ name, ok: !!ok });
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    return !!ok;
  }

  function sample(role) {
    const entry = SAMPLES[role];
    if (!entry) throw new Error(`Unknown sample role "${role}" (see tools/samples.json)`);
    const file = path.join(ROOT, 'samples', entry.file);
    if (!fs.existsSync(file)) throw new Error(`Sample book for "${role}" not found: samples/${entry.file} (${entry.about})`);
    return file;
  }

  async function open(role, { timeout = 60000 } = {}) {
    const file = sample(role);
    await exec(`app.openBook(${JSON.stringify(file)})`);
    const ok = await waitFor(`app.activeTab?.path === ${JSON.stringify(file)} && !!app.activeTab.viewer`, timeout);
    if (!ok) {
      const error = await exec(`app.activeTab?.paneEl.querySelector('.pane-message.error')?.innerText ?? null`);
      throw new Error(`Could not open the "${role}" sample${error ? ': ' + error : ''}`);
    }
    return file;
  }

  function press(key, { ctrl = false, shift = false, code = keyCode(key) } = {}) {
    return exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: ${ctrl}, shiftKey: ${shift}, bubbles: true }))`);
  }

  async function tocItem(index) {
    await exec(`(() => {
      const panel = document.getElementById('toc-panel');
      const wasHidden = panel.hidden;
      if (wasHidden) document.getElementById('btn-toc').click();
      app.showSidePanel('toc');
      document.querySelectorAll('.toc-item')[${index}].click();
      if (wasHidden) document.getElementById('btn-toc').click();
    })()`);
  }

  // Visible pages of the active PDF/DjVu tab have their canvases drawn
  async function pagesReady(timeout = 60000) {
    await wait(150);
    return waitFor(`(() => {
      const pages = [...app.activeTab.paneEl.querySelectorAll('.fixed-page:not(.off)')]
        .filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
      return pages.length > 0 && pages.every((p) => p.querySelector('canvas') && !p.classList.contains('loading'));
    })()`, timeout);
  }

  const location = () => exec(`app.activeTab.viewer.getLocation()`);

  return {
    lang: LANG,
    t: translator(LANG),
    translator,
    check,
    sample,
    open,
    press,
    tocItem,
    pagesReady,
    location,
    results,
  };
}

module.exports = { createKit, LANG };
