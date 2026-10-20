// Dark theme for PDF/DjVu: text pages are inverted, covers and photos are not
const path = require('node:path');
module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll', theme: 'dark' })`);
  for (const [name, pages] of [['Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf', [0, 20, 205]], ['Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu', [0, 150]]]) {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 30000);
    for (const page of pages) {
      await exec(`app.activeTab.viewer.goTo({ page: ${page}, f: 0 })`);
      await waitFor(`(() => { const p = app.activeTab.paneEl.querySelector('.fixed-page[data-num="${page + 1}"]'); return p.querySelector('canvas') && !p.classList.contains('loading'); })()`, 30000);
      log(name.slice(0, 20), 'page', page + 1, 'pictorial =', await exec(`app.activeTab.paneEl.querySelector('.fixed-page[data-num="${page + 1}"]').classList.contains('pictorial')`));
    }
    await exec(`app.activeTab.viewer.goTo({ page: 0, f: 0 })`);
    await wait(500);
    await shot(`dark-${name.slice(0, 6)}-cover`);
  }
};
