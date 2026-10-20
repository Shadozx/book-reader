const path = require('node:path');

module.exports = async ({ root, exec, waitFor, shot, wait, resize, log }) => {
  const file = JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'));
  const state = async (label) => {
    await wait(150);
    const s = await exec(`JSON.stringify({ loc: app.activeTab.viewer.getLocation(), progress: app.activeTab.viewer.progress().text, toc: document.querySelector('.toc-item.current')?.textContent })`);
    log(label.padEnd(28), s);
    return JSON.parse(s);
  };
  const key = (k, shift = false) => exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, shiftKey: ${shift}, bubbles: true }))`);

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await exec(`app.openBook(${file})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`document.getElementById('btn-toc').click()`);
  await exec(`document.querySelectorAll('.toc-item')[5].click()`);
  await wait(700);   // like a human: first look where it went
  await key('PageDown'); await wait(600);
  const a = await state('scroll after PageDown');
  await shot('s3-01-scroll');

  await exec(`app.updateSettings({ mode: 'paged' })`);
  const b = await state('-> paged (spread)');
  await shot('s3-02-paged-spread');

  for (let i = 0; i < 3; i++) await key('ArrowRight');
  await state('paged +3 pages');
  await shot('s3-03-paged-next');

  // Crossing a section boundary
  const screens = await exec(`app.activeTab.viewer.progress().text`);
  for (let i = 0; i < 40; i++) await key('PageDown');
  await state('paged +40 pages');
  for (let i = 0; i < 40; i++) await key('PageUp');
  await state('paged -40 pages (back)');

  await exec(`document.getElementById('btn-toc').click()`);
  resize(800, 860);
  await wait(500);
  const c = await state('narrow window (single)');
  await shot('s3-04-paged-narrow');

  await exec(`app.updateSettings({ fontSize: 26 })`);
  const d = await state('font 26');
  await shot('s3-05-paged-font26');

  await exec(`app.updateSettings({ mode: 'scroll', fontSize: 20 })`);
  const e = await state('-> scroll, font 20');
  await shot('s3-06-scroll-back');

  await exec(`app.setTheme('dark')`);
  await exec(`app.updateSettings({ mode: 'paged' })`);
  resize(1280, 860);
  await wait(400);
  await state('dark paged wide');
  await shot('s3-07-dark-paged');

  // Footnote in paged mode
  const note = await exec(`(() => { const a = document.querySelector('.pane:not([hidden]) .page-strip a.note-link'); if (!a) return 'no note on page'; a.click(); return !!document.querySelector('.note-popup'); })()`);
  log('paged note popup', note);

  const same = (x, y) => x.loc.c === y.loc.c && Math.abs(x.loc.b - y.loc.b) <= 2;
  log('CHECK scroll->paged keeps place:', same(a, b));
  log('CHECK font change keeps place:', same(c, d));
  log('CHECK paged->scroll keeps place:', same(d, e));
};
