// Data export and import: backup file, full restore after "Reset all", rejection of foreign files.
// File dialogs are replaced by the AUTOTEST_DIALOG_FILE variable (path to the file).
const path = require('node:path');
const fs = require('node:fs');

module.exports = async ({ root, exec, waitFor, wait, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const outDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'chytalka-backup-test-'));
  fs.mkdirSync(outDir, { recursive: true });
  const backupFile = path.join(outDir, 'chytalka-backup.json');
  const open = async (name) => {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab?.viewer`, 30000);
  };
  const reloaded = async () => {
    await wait(1500);
    await waitFor(`window.app && document.readyState === 'complete'`, 15000);
    await wait(800);
  };

  // The state to be saved
  await open('Diuna.fb2');
  await exec(`app.toggleBookmark()`);
  await open('Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf');
  await exec(`app.updateSettings({ theme: 'dark', fontSize: 24, mode: 'paged' })`);
  await exec(`app.store.reading.chars = 1500`);

  // 1) Export
  process.env.AUTOTEST_DIALOG_FILE = backupFile;
  fs.rmSync(backupFile, { force: true });
  await exec(`app.exportData()`);
  await wait(300);
  const backup = fs.existsSync(backupFile) ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : null;
  check('файл резервної копії створено', !!backup);
  if (backup) {
    const books = Object.values(backup.state.books ?? {});
    check('формат і дата у файлі', backup.format === 'chytalka-backup' && backup.version === 1 && !isNaN(Date.parse(backup.exported)));
    check('у копії 2 книги з місцями читання', books.length === 2 && books.every((b) => b.location));
    check('у копії закладка', books.reduce((s, b) => s + (b.bookmarks?.length ?? 0), 0) === 1);
    check('у копії налаштування і швидкість читання', backup.state.settings.theme === 'dark' && backup.state.settings.fontSize === 24 && backup.state.reading.chars === 1500);
    check('положення вікна в копію не потрапляє', backup.state.window === undefined);
  }

  // 2) "Reset all", 3) import
  await exec(`app.resetAll()`).catch(() => {});
  await reloaded();
  check('після скидання даних немає', await exec(`Object.keys(app.store.books).length === 0 && app.store.settings.theme === 'light'`));

  const info = await exec(`window.api.importRead()`);
  check('імпорт: підсумок перед підтвердженням', info && info.books === 2 && info.bookmarks === 1 && !!info.exported, JSON.stringify(info));
  await exec(`app.importData()`).catch(() => {});   // confirmed by the autotest; the window reloads
  await reloaded();
  await waitFor(`app.tabs.length === 2 && app.tabs.every(t => t.viewer)`, 30000);
  check('після імпорту — налаштування', await exec(`app.store.settings.theme === 'dark' && app.store.settings.fontSize === 24 && app.store.settings.mode === 'paged'`));
  check('після імпорту — книги, місця читання, закладка', await exec(`(() => { const b = Object.values(app.store.books); return b.length === 2 && b.every(x => x.location) && b.reduce((s, x) => s + (x.bookmarks?.length ?? 0), 0) === 1; })()`));
  check('після імпорту — вкладки відновлено', await exec(`app.tabs.length === 2`));
  check('після імпорту — швидкість читання', await exec(`app.store.reading.chars === 1500`));

  // 4) A foreign file is rejected
  const foreign = path.join(outDir, 'foreign.json');
  fs.writeFileSync(foreign, JSON.stringify({ hello: 'world', items: [1, 2] }));
  process.env.AUTOTEST_DIALOG_FILE = foreign;
  const bad = await exec(`window.api.importRead()`);
  check('чужий JSON відхилено', bad?.error === 'Це не резервна копія Chytalka.', bad?.error);
  const broken = path.join(outDir, 'broken.json');
  fs.writeFileSync(broken, '{ not json');
  process.env.AUTOTEST_DIALOG_FILE = broken;
  check('пошкоджений файл відхилено', (await exec(`window.api.importRead()`))?.error?.startsWith('Файл пошкоджений'));

  // 5) A raw state.json is accepted too
  const raw = path.join(outDir, 'state.json');
  fs.writeFileSync(raw, JSON.stringify(backup.state));
  process.env.AUTOTEST_DIALOG_FILE = raw;
  const rawInfo = await exec(`window.api.importRead()`);
  check('звичайний state.json приймається', rawInfo?.books === 2 && rawInfo.exported === null);

  delete process.env.AUTOTEST_DIALOG_FILE;
  fs.rmSync(outDir, { recursive: true, force: true });
  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
