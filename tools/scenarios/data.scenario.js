// "Data" section: reset settings, clear history, "Reset all", uninstall (in the dev version)
// Confirmation dialogs are answered "yes" automatically in autotests (AUTOTEST_AUTOCONFIRM).
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, wait, shot, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const open = async (name) => {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab?.viewer`, 30000);
  };
  const isDefault = `Object.keys(app.DEFAULT_SETTINGS).every(k => app.store.settings[k] === app.DEFAULT_SETTINGS[k])`;

  await open('Diuna.fb2');
  await open('Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf');
  await exec(`app.toggleBookmark()`);
  await exec(`app.updateSettings({ theme: 'dark', fontSize: 28, mode: 'paged', lineHeight: 2 })`);

  await exec(`document.getElementById('btn-settings').click()`);
  check('розділ «Дані» в панелі налаштувань', await exec(`[...document.querySelectorAll('.data-section .data-btn')].map(b => b.textContent).join(' | ')`) ===
    'Скинути налаштування | Очистити історію читання… | Скинути все й перезапустити… | Експортувати дані… | Імпортувати дані… | Видалити програму…');
  await shot('data-01-panel');

  // 1) Reset settings: books, tabs and bookmarks stay
  await exec(`[...document.querySelectorAll('.data-btn')].find(b => b.textContent === 'Скинути налаштування').click()`);
  await wait(300);
  check('налаштування скинуто', await exec(isDefault));
  check('вкладки й закладки на місці', await exec(`app.tabs.length === 2 && Object.values(app.store.books).some(b => b.bookmarks?.length)`));

  // 2) Clear history: tabs close, history and bookmarks disappear
  await exec(`app.updateSettings({ theme: 'sepia' })`);
  await exec(`app.clearHistory()`);
  await wait(500);
  check('історію очищено', await exec(`app.tabs.length === 0 && Object.keys(app.store.books).length === 0`));
  check('список нещодавніх порожній', await exec(`document.getElementById('recent-block').hidden`));
  check('налаштування після очищення історії не змінились', await exec(`app.store.settings.theme === 'sepia'`));
  await shot('data-02-after-clear');

  // 3) Reset all: the window reloads with a clean state
  await open('Diuna.fb2');
  await exec(`app.toggleBookmark()`);
  await exec(`app.updateSettings({ theme: 'dark', fontSize: 30 })`);
  await exec(`app.store.reading.chars = 2500`);
  await wait(600);   // the state has been saved to the file
  await exec(`app.resetAll()`).catch(() => {});   // the page reloads, so the call may be cut off
  await wait(1500);
  await waitFor(`window.app && document.readyState === 'complete'`, 15000);
  await wait(500);
  check('після «Скинути все» — налаштування стандартні', await exec(isDefault));
  check('після «Скинути все» — немає вкладок, історії, закладок', await exec(`app.tabs.length === 0 && Object.keys(app.store.books).length === 0`));
  check('після «Скинути все» — швидкість читання типова', await exec(`app.store.reading.chars === 1100`));
  check('після «Скинути все» — стартовий екран', await exec(`!document.getElementById('welcome').hidden`));

  // 4) Uninstall in the dev version: a message that it's only available in the installed app
  check('у dev-версії деінсталятора немає', (await exec(`window.api.uninstallInfo().then(i => i.installed)`)) === false);
  await exec(`app.uninstallApp()`);
  check('програма лишилась відкритою', await exec(`!!window.app`));

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
