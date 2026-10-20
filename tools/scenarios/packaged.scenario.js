// Check of the built app (all formats open from app.asar)
// AUTOTEST_APP=dist/win-unpacked/resources/app.asar npx electron tools/autotest.js tools/scenarios/packaged.scenario.js <out>
const path = require('node:path');

const BOOKS = [
  'Diuna.fb2',
  'Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub',
  'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf',
  'Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu',
];

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  log('app root:', await exec(`location.href`));
  for (const name of BOOKS) {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.format && !app.activeTab.paneEl.querySelector('.spinner')`, 60000);
    const err = await exec(`app.activeTab.paneEl.querySelector('.pane-message.error')?.innerText ?? null`);
    if (err) { log('FAIL', name, err); continue; }
    // A PDF cover may have no text, so check the text layer on a page with text
    if (name.endsWith('.pdf')) await exec(`app.activeTab.viewer.goTo({ page: 20, f: 0 })`);
    const ok = await waitFor(`(() => { const v = app.activeTab.viewer; if (!v) return false; const el = app.activeTab.paneEl;
      return v.kind === 'flow' ? el.querySelectorAll('.book-content p').length > 100
        : [...el.querySelectorAll('.fixed-page canvas')].length > 0 && !!el.querySelector('.textLayer span, .djvuTextLayer span'); })()`, 30000);
    log(ok ? 'OK  ' : 'FAIL', name.slice(0, 40));
  }
  await shot('packaged');
};
