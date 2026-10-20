// Current chapter and progress within it (the line under the book title + the bar under the toolbar)
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, wait, shot, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const info = async () => JSON.parse(await exec(`JSON.stringify({ ...app.activeTab.viewer.chapterInfo?.(), line: document.getElementById('book-author').textContent, bar: !document.getElementById('chapter-bar').hidden, width: document.querySelector('#chapter-bar > span').style.width })`));
  const key = (k) => exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`);

  // FB2, scroll mode
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`(() => { document.getElementById('btn-toc').click(); app.showSidePanel('toc'); document.querySelectorAll('.toc-item')[6].click(); document.getElementById('btn-toc').click(); })()`);
  await wait(500);
  const a = await info();
  check('на початку розділу прогрес близький до 0', a.progress < 0.05 && a.bar, `${(a.progress * 100).toFixed(1)}%, рядок: «${a.line.replace(/ · .*/, '')} · …»`);
  const values = [a.progress];
  for (let i = 0; i < 4; i++) {
    await key('PageDown');
    await wait(500);
    values.push((await info()).progress);
  }
  check('прогрес росте з кожним PageDown', values.every((v, i) => i === 0 || v > values[i - 1]), values.map((v) => (v * 100).toFixed(1) + '%').join(' → '));
  const b = await info();
  check('у рядку «прочитано N%»', /прочитано \d+%( · ще .+)?$/.test(b.line) && b.width.endsWith('%'));
  await shot('chapter-fb2');

  // End of a chapter: right before the next TOC entry the progress is close to 100%
  await exec(`(() => { document.getElementById('btn-toc').click(); document.querySelectorAll('.toc-item')[7].click(); document.getElementById('btn-toc').click(); })()`);
  await wait(500);
  await exec(`app.activeTab.paneEl.querySelector('.flow-scroller').scrollBy(0, -300)`);
  await wait(500);
  const end = await info();
  check('у кінці попереднього розділу прогрес близький до 100%', end.progress > 0.95, `${(end.progress * 100).toFixed(1)}%`);

  // Paged mode
  await exec(`app.updateSettings({ mode: 'paged' })`);
  // Start from the beginning of a chapter (from the end, the next page is already a new chapter at 0%)
  await exec(`(() => { document.getElementById('btn-toc').click(); document.querySelectorAll('.toc-item')[6].click(); document.getElementById('btn-toc').click(); })()`);
  await wait(400);
  const p1 = (await info()).progress;
  await key('ArrowRight');
  await wait(300);
  const p2 = (await info()).progress;
  check('посторінковий режим: прогрес розділу росте', p2 > p1, `${(p1 * 100).toFixed(1)}% → ${(p2 * 100).toFixed(1)}%`);
  await exec(`app.updateSettings({ mode: 'scroll' })`);

  // PDF without a TOC: the author is shown, no bar
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await wait(300);
  const pdf = await info();
  check('PDF без змісту: смужки немає', !pdf.bar && pdf.progress === undefined);

  // DjVu with a TOC: "page N of M"
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu'))})`);
  await waitFor(`app.activeTab.viewer && app.activeTab.viewer.toc.length > 0`, 30000);
  await exec(`app.activeTab.viewer.goTo({ page: 150, f: 0 })`);
  await wait(800);
  const dj = await info();
  check('DjVu: «стор. N з M» у межах розділу', /стор\. \d+ з \d+( · ще .+)?$/.test(dj.line) && dj.bar && dj.page >= 1 && dj.page <= dj.pages, `стор. ${dj.page} з ${dj.pages}, ${(dj.progress * 100).toFixed(0)}%`);
  await shot('chapter-djvu');

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
