// Interface language: switching without a restart, no Ukrainian left in the English UI,
// native dialogs follow the setting, "System" follows the Windows language list, dictionaries match
const path = require('node:path');
const fs = require('node:fs');

module.exports = async ({ root, exec, waitFor, wait, shot, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const key = (code, k) => exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', code: '${code}', ctrlKey: true, bubbles: true }))`);
  const clickSeg = (value) => exec(`document.querySelector('.settings-popover .seg button[data-value="${value}"]').click()`);

  // 1) Both dictionaries have the same keys and the same kind of values
  const dicts = Object.fromEntries(['uk', 'en'].map((l) => [l, JSON.parse(fs.readFileSync(path.join(root, 'src/renderer/locales', `${l}.json`), 'utf8'))]));
  const diff = [...new Set([...Object.keys(dicts.uk), ...Object.keys(dicts.en)])]
    .filter((k) => !(k in dicts.uk) || !(k in dicts.en) || typeof dicts.uk[k] !== typeof dicts.en[k]);
  check('uk.json і en.json мають однакові ключі', diff.length === 0, diff.join(', '));
  const params = (s) => [...JSON.stringify(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const paramDiff = Object.keys(dicts.uk).filter((k) => k in dicts.en && params(dicts.uk[k]) !== params(dicts.en[k]));
  check('однакові підстановки {…} в обох мовах', paramDiff.length === 0, paramDiff.join(', '));
  const cyrillic = Object.entries(dicts.en).filter(([, v]) => /[А-Яа-яІіЇїЄєҐґ]/.test(JSON.stringify(v)));
  check('в en.json немає українських слів', cyrillic.length === 0, cyrillic.map(([k]) => k).join(', '));

  // 2) Starts in Ukrainian (autotests set the system language to Ukrainian)
  check('стартує українською', await exec(`document.documentElement.lang === 'uk' && document.querySelector('#welcome h1').textContent === 'Читалка'`));

  // A book with a Latin title, so the book's own text doesn't count as untranslated UI
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf'))})`);
  await waitFor(`app.activeTab?.viewer`, 30000);
  await exec(`app.toggleBookmark()`);

  // 3) Switch to English in the settings panel
  await exec(`document.getElementById('btn-settings').click()`);
  await clickSeg('en');
  await waitFor(`document.documentElement.lang === 'en'`, 5000);
  await wait(300);
  check('мова перемкнулась без перезапуску', await exec(`app.store.settings.language === 'en' && document.title.endsWith('Chytalka')`), await exec(`document.title`));
  check('панель налаштувань лишилась відкритою й перекладена', await exec(`!document.querySelector('.settings-popover').hidden && document.querySelector('.settings-popover h3').textContent === 'Language'`));
  check('вибрано English', await exec(`document.querySelector('.settings-popover .seg button[data-value="en"]').classList.contains('on')`));
  await shot('language-01-settings-en');

  // Every visible and hidden UI text, tooltip and placeholder, except the book itself,
  // the language names and the backup folder path
  const leftovers = `(() => {
    // The toast is hidden and gets a new text every time it's shown
    const skip = (el) => el.closest('#toast, .pane, .backup-dir, .seg button[data-value="uk"], #book-title, #book-author, .tab-title, .lib-name, .lib-sub, .recent-title, .recent-sub');
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/[А-Яа-яІіЇїЄєҐґ]/.test(n.textContent) && !skip(n.parentElement)) out.push(n.textContent.trim().slice(0, 50));
    }
    for (const el of document.querySelectorAll('[title], [placeholder], [aria-label]')) {
      if (skip(el)) continue;
      for (const a of ['title', 'placeholder', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v && /[А-Яа-яІіЇїЄєҐґ]/.test(v) && !(a === 'title' && el.classList.contains('tab'))) out.push(a + ': ' + v.slice(0, 50));
      }
    }
    return out;
  })()`;
  let left = await exec(leftovers);
  check('у вікні з книгою немає українських текстів', left.length === 0, left.join(' | '));

  await exec(`document.getElementById('btn-settings').click()`);
  await exec(`app.openLibrary()`);
  await wait(500);
  left = await exec(leftovers);
  check('у бібліотеці немає українських текстів', left.length === 0, left.join(' | '));
  const stats = await exec(`[...document.querySelectorAll('.library-stats > span')].map(x => x.textContent).join(' | ')`);
  check('множина англійською', stats === '1 book | 1 with a reading position | 1 bookmark', stats);
  await shot('language-02-library-en');
  await exec(`app.closeLibrary()`);

  await key('Equal', '=');
  check('сповіщення англійською', await exec(`document.getElementById('toast').textContent.startsWith('Zoom: ')`), await exec(`document.getElementById('toast').textContent`));
  check('підказка закладки англійською', await exec(`document.getElementById('btn-bookmark').title === 'Remove bookmark (Ctrl+D)'`));

  // 4) Native dialogs (main process) follow the setting: the import error comes from there
  const junk = path.join(process.env.CHYTALKA_BACKUP_DIR, 'not-a-backup.json');
  fs.mkdirSync(path.dirname(junk), { recursive: true });
  fs.writeFileSync(junk, '{"hello": 1}');
  process.env.AUTOTEST_DIALOG_FILE = junk;
  const err = await exec(`window.api.importRead().then(r => r.error)`);
  delete process.env.AUTOTEST_DIALOG_FILE;
  check('системні діалоги англійською', err === 'This is not a Chytalka backup.', err);

  // 5) "System": follows the first Windows language
  process.env.CHYTALKA_SYSTEM_LANG = 'en-US';
  await exec(`app.updateSettings({ language: 'auto' })`);
  await wait(300);
  check('«Як у системі» при англійській Windows — English', await exec(`document.documentElement.lang === 'en'`));
  process.env.CHYTALKA_SYSTEM_LANG = 'uk';
  await exec(`app.updateSettings({ language: 'en' })`);
  await exec(`app.updateSettings({ language: 'auto' })`);
  await waitFor(`document.documentElement.lang === 'uk'`, 5000);
  await wait(300);
  check('«Як у системі» при українській — українська', await exec(`document.getElementById('btn-bookmark').title === 'Прибрати закладку (Ctrl+D)' && document.title.endsWith('Читалка')`));
  process.env.AUTOTEST_DIALOG_FILE = junk;
  const errUk = await exec(`window.api.importRead().then(r => r.error)`);
  delete process.env.AUTOTEST_DIALOG_FILE;
  check('системні діалоги повернулись до української', errUk === 'Це не резервна копія «Читалки».', errUk);

  // 6) The language doesn't change how the book is laid out
  await exec(`app.updateSettings({ language: 'en' })`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'))})`);
  await waitFor(`app.activeTab?.viewer && app.activeTab.format === 'fb2'`, 30000);
  const bookLang = await exec(`app.activeTab.paneEl.querySelector('.book-content').lang`);
  check('перенесення в книзі за мовою книги, а не інтерфейсу', bookLang === 'ru' || bookLang === 'uk', bookLang);
  await shot('language-03-book-en');
  await exec(`app.updateSettings({ language: 'auto' })`);

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
