// Dark theme for PDF/DjVu: text pages are inverted (light text on dark), covers and photos are not

module.exports = async ({ open, exec, waitFor, check, skip, has, log, shot }) => {
  await exec(`app.updateSettings({ mode: 'scroll', theme: 'dark' })`);
  const pictorial = async (page) => {
    await exec(`app.activeTab.viewer.goTo({ page: ${page}, f: 0 })`);
    await waitFor(`(() => { const p = app.activeTab.paneEl.querySelector('.fixed-page[data-num="${page + 1}"]'); return p.querySelector('canvas') && !p.classList.contains('loading'); })()`, 30000);
    return exec(`app.activeTab.paneEl.querySelector('.fixed-page[data-num="${page + 1}"]').classList.contains('pictorial')`);
  };

  // The generated PDF has a picture cover and text pages
  await open('pdf');
  const pages = await exec(`app.activeTab.viewer.pageCount`);
  check('pdf: the picture cover keeps its colours', await pictorial(0));
  check('pdf: a text page is inverted', !(await pictorial(Math.floor(pages / 2))));
  await exec(`app.activeTab.viewer.goTo({ page: 0, f: 0 })`);
  await shot('dark-pdf-cover');

  if (!has('djvu')) return skip('djvu: no optional sample book');
  await open('djvu');
  const djvuPages = await exec(`app.activeTab.viewer.pageCount`);
  log(`djvu: cover pictorial = ${await pictorial(0)}`);
  check('djvu: a text page is inverted', !(await pictorial(Math.floor(djvuPages / 2))));
  await exec(`app.activeTab.viewer.goTo({ page: 0, f: 0 })`);
  await shot('dark-djvu-cover');
};
