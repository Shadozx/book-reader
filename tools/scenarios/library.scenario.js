// Library (Ctrl+L) and automatic backups in Documents\Chytalka
// (the autotest replaces the backup folder with a test one via CHYTALKA_BACKUP_DIR)
const path = require('node:path');
const fs = require('node:fs');

module.exports = async ({ root, exec, waitFor, wait, shot, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const sample = (name) => path.join(root, 'samples', name);
  const open = async (name) => {
    await exec(`app.openBook(${JSON.stringify(sample(name))})`);
    await waitFor(`app.activeTab?.viewer`, 30000);
  };
  const rows = () => exec(`[...document.querySelectorAll('#library .lib-item')].map(r => r.querySelector('.lib-title').childNodes[0].textContent)`);
  const backupDir = process.env.CHYTALKA_BACKUP_DIR;
  const today = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  const todayFile = path.join(backupDir, `chytalka-auto-${today}.json`);

  // Books the app will "remember"
  await open('Diuna.fb2');
  await exec(`app.toggleBookmark()`);
  await open('Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub');
  await open('Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf');
  await exec(`app.closeTab(app.tabs.find(t => t.format === 'epub'))`);
  // A book whose file was "moved"
  const movedPath = 'C:\\nonexistent-folder\\moved-book.fb2';
  await exec(`(() => { app.store.books[${JSON.stringify(movedPath)}] = { title: 'Переміщена книга', format: 'fb2', lastOpened: Date.now() - 2 * 86400000, location: { c: 3, b: 5, f: 0 }, progress: 0.4, bookmarks: [{ text: 'тест', percent: 0.4, location: { c: 3, b: 5, f: 0 } }] }; })()`);

  // 1) The library opens with Ctrl+L
  await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, bubbles: true }))`);
  await wait(500);
  check('Ctrl+L відкриває бібліотеку', await exec(`!document.getElementById('library').hidden`));
  check('у бібліотеці 4 книги', (await rows()).length === 4, (await rows()).join(' | '));
  // Each stat is a separate block (with a gap between them on screen), so compare block by block
  const stats = await exec(`[...document.querySelectorAll('.library-stats > span')].map(x => x.textContent).join(' | ')`);
  check('підсумок: книги, місця читання, закладки, не знайдені', stats === '4 книги | 4 з місцем читання | 2 закладки | 1 файл не знайдено', stats);
  check('позначки «відкрита» і «файл не знайдено»', await exec(`document.querySelectorAll('#library .chip:not(.warn)').length === 2 && document.querySelectorAll('#library .chip.warn').length === 1`));
  await shot('library-01');

  // 2) Search and sorting
  await exec(`(() => { const s = document.querySelector('.library-search'); s.value = 'мужество'; s.dispatchEvent(new Event('input')); })()`);
  await wait(300);
  check('пошук за назвою', (await rows()).length === 1);
  await exec(`(() => { const s = document.querySelector('.library-search'); s.value = ''; s.dispatchEvent(new Event('input')); const o = document.querySelector('.library-sort'); o.value = 'progress'; o.dispatchEvent(new Event('change')); })()`);
  await wait(300);
  check('сортування за прогресом', (await rows())[0] === 'Переміщена книга', (await rows()).join(' | '));

  // 3) "Find file…": the data moves to the new path
  const newPath = sample('Platon_Apologiya_Sokrata_Dialogi_1dfc1e_500611.fb2');
  process.env.AUTOTEST_DIALOG_FILE = newPath;
  await exec(`[...document.querySelectorAll('#library .lib-item.missing .lib-btn')].find(b => b.textContent === 'Знайти файл…').click()`);
  await wait(600);
  delete process.env.AUTOTEST_DIALOG_FILE;
  check('знайдений файл: місце читання й закладка перейшли', await exec(`(() => { const b = app.store.books[${JSON.stringify(newPath)}]; return !app.store.books[${JSON.stringify(movedPath)}] && b?.location?.c === 3 && b?.location?.b === 5 && b?.bookmarks?.length === 1; })()`));
  check('після цього «не знайдених» немає', await exec(`document.querySelectorAll('#library .lib-item.missing').length === 0`));

  // 4) "Forget": an open book can't be forgotten, a closed one can
  check('«Забути» недоступне для відкритої книги', await exec(`[...document.querySelectorAll('#library .lib-item')].filter(r => r.querySelector('.chip:not(.warn)')).every(r => [...r.querySelectorAll('.lib-btn')].find(b => b.textContent === 'Забути').disabled)`));
  await exec(`[...document.querySelectorAll('#library .lib-item')].find(r => r.textContent.includes('Мужество')).querySelector('.lib-btn.danger').click()`);
  await wait(400);
  check('закриту книгу забуто', (await rows()).length === 3 && !(await rows()).some((t) => t.includes('Мужество')));

  // 5) Open from the library
  // The relinked book still has its old title (updated when it's opened), so find the row by path
  await exec(`[...document.querySelectorAll('#library .lib-item')].find(r => r.title === ${JSON.stringify(newPath)}).querySelector('.lib-btn.primary').click()`);
  await waitFor(`app.activeTab?.viewer && app.activeTab.path === ${JSON.stringify(newPath)}`, 30000);
  check('книга відкрилась, бібліотека закрилась', await exec(`document.getElementById('library').hidden`));
  check('відкрилась на збереженому місці', await exec(`app.activeTab.viewer.getLocation().c === 3`));

  // 6) Automatic backup
  await wait(800);
  check('автокопія дня створена в папці копій', fs.existsSync(todayFile));
  if (fs.existsSync(todayFile)) {
    const backup = JSON.parse(fs.readFileSync(todayFile, 'utf8'));
    check('автокопія у форматі резервної копії з книгами', backup.format === 'chytalka-backup' && Object.keys(backup.state.books).length >= 2);
  }
  // Rotation: only the last 10 auto backups are kept; manual backups are left alone
  for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(backupDir, `chytalka-auto-2020-01-${String(i).padStart(2, '0')}.json`), '{}');
  fs.writeFileSync(path.join(backupDir, 'chytalka-backup-2020-01-01.json'), '{}');
  process.env.CHYTALKA_BACKUP_EVERY_MS = '1';
  await exec(`app.updateSettings({ fontSize: 21 })`);
  await wait(1200);
  const autos = fs.readdirSync(backupDir).filter((f) => /^chytalka-auto-/.test(f)).sort();
  check('зберігаються лише 10 останніх автокопій', autos.length === 10 && autos.at(-1) === `chytalka-auto-${today}.json`, autos.length + ' файлів');
  check('ручна копія не видалена', fs.existsSync(path.join(backupDir, 'chytalka-backup-2020-01-01.json')));
  // Turning it off
  fs.rmSync(todayFile);
  await exec(`document.getElementById('btn-app').click()`);
  check('перемикач автокопій у розділі «Дані» увімкнений', await exec(`document.querySelector('.data-section input[type=checkbox]').checked`));
  await exec(`(() => { const c = document.querySelector('.data-section input[type=checkbox]'); c.click(); })()`);
  await exec(`app.updateSettings({ fontSize: 22 })`);
  await wait(1200);
  check('вимкнена автокопія не створюється', !fs.existsSync(todayFile));
  delete process.env.CHYTALKA_BACKUP_EVERY_MS;
  await shot('library-02-data');

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
