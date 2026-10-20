// Bookmarks: Ctrl+D adds/removes, the list in the side panel, navigation by click
// This scenario is followed by bookmarks-restore.scenario.js (AUTOTEST_KEEP_STATE=1)
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const ctrlD = () => exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, bubbles: true }))`);
  const loc = () => exec(`JSON.stringify(app.activeTab.viewer.getLocation())`);
  const count = () => exec(`(app.activeTab.record.bookmarks ?? []).length`);

  // FB2
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`document.getElementById('btn-toc').click()`);
  await exec(`app.showSidePanel('toc')`);
  await exec(`document.querySelectorAll('.toc-item')[8].click()`);
  await wait(700);
  const markLoc = await loc();
  await ctrlD();
  check('Ctrl+D додає закладку', (await count()) === 1);
  check('кнопка закладки підсвічена', await exec(`document.getElementById('btn-bookmark').classList.contains('active')`));
  check('підпис закладки — розділ і початок абзацу', await exec(`(() => { const b = app.activeTab.record.bookmarks[0]; return b.chapter.length > 0 && b.text.length > 10; })()`));

  await exec(`document.querySelectorAll('.toc-item')[20].click()`);
  await wait(600);
  check('в іншому місці кнопка не підсвічена', !(await exec(`document.getElementById('btn-bookmark').classList.contains('active')`)));
  await exec(`app.showSidePanel('bookmarks')`);
  check('закладка в списку бокової панелі', (await exec(`document.querySelectorAll('#bookmark-list .bookmark-item').length`)) === 1);
  await shot('bm-01-panel');
  await exec(`document.querySelector('#bookmark-list .bookmark-item').click()`);
  await wait(700);
  const backLoc = await loc();
  check('клік по закладці повертає на те саме місце', JSON.parse(backLoc).c === JSON.parse(markLoc).c && JSON.parse(backLoc).b === JSON.parse(markLoc).b, `${markLoc} → ${backLoc}`);
  await ctrlD();
  check('повторний Ctrl+D на тому ж місці прибирає закладку', (await count()) === 0);
  await ctrlD();   // keep a bookmark to check after the restart

  // PDF
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`app.activeTab.viewer.goTo({ page: 50, f: 0 })`);
  await wait(500);
  await exec(`document.getElementById('btn-bookmark').click()`);
  check('закладка в PDF', await exec(`app.activeTab.record.bookmarks?.[0]?.text === 'Сторінка 51'`), await exec(`app.activeTab.record.bookmarks?.[0]?.text`));
  check('панель без змісту відкривається на закладках', await exec(`(() => { document.getElementById('toc-panel').hidden = true; document.getElementById('btn-toc').click(); return !document.getElementById('bookmark-list').hidden; })()`));
  await shot('bm-02-pdf');

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
