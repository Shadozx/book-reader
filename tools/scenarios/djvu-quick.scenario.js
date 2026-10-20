// Quick DjVu check on one book: speed, text layer, TOC
const path = require('node:path');

const BOOK = process.env.DJVU_BOOK || 'Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu';

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  const pane = `app.activeTab.paneEl`;
  const settle = async (timeout = 60000) => {
    await wait(100);
    const t0 = Date.now();
    await waitFor(`(() => { const ps = [...${pane}.querySelectorAll('.fixed-page:not(.off)')].filter(p => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }); return ps.length > 0 && ps.every(p => p.querySelector('canvas') && !p.classList.contains('loading')); })()`, timeout);
    return Date.now() - t0;
  };

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  const t0 = Date.now();
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', BOOK))})`);
  await waitFor(`app.activeTab.format && !${pane}.querySelector('.spinner')`, 60000);
  const openMs = Date.now() - t0;
  const err = await exec(`${pane}.querySelector('.pane-message.error')?.innerText ?? null`);
  if (err) return log('ERROR', err);
  const firstMs = await settle();
  log(`open ${openMs} ms, first page +${firstMs} ms`);

  await waitFor(`app.activeTab.viewer.toc.length > 0`, 20000);
  log('toc', await exec(`app.activeTab.viewer.toc.length + ' items, button enabled: ' + !document.getElementById('btn-toc').disabled`));

  const t1 = Date.now();
  await exec(`app.activeTab.viewer.goTo({ page: 150, f: 0 })`);
  await settle();
  log(`page 151: ${Date.now() - t1} ms`);
  await wait(800);
  log('text layer', await exec(`(() => { const p = ${pane}.querySelector('.fixed-page[data-num="151"]'); const spans = p.querySelectorAll('.djvuTextLayer span'); return spans.length + ' words; sample: ' + [...spans].slice(0, 6).map(s => s.textContent.trim()).join(' '); })()`));
  await shot('djvu-quick-page151');

  // Text selection: select the first words and check that meaningful text is copied
  log('selection', await exec(`(() => { const spans = ${pane}.querySelectorAll('.fixed-page[data-num="151"] .djvuTextLayer span'); if (spans.length < 5) return 'no spans'; const r = document.createRange(); r.setStartBefore(spans[0]); r.setEndAfter(spans[8]); const s = getSelection(); s.removeAllRanges(); s.addRange(r); const t = s.toString(); s.removeAllRanges(); return JSON.stringify(t.slice(0, 80)); })()`));

  const t2 = Date.now();
  await exec(`app.activeTab.viewer.goTo({ page: 0, f: 0 })`);
  await settle();
  log(`cover page: ${Date.now() - t2} ms`);
  await shot('djvu-quick-cover');
};
