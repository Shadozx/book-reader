// TOC jump followed immediately by PageDown (no pause at all): the position must not "slide"
// into the previous section because of the estimated height of not yet laid out sections (content-visibility).
const path = require('node:path');

const BOOKS = ['Diuna.fb2', 'Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub'];
const TOC_ITEMS = [5, 12, 25, 40, 3, 30];

module.exports = async ({ root, exec, waitFor, wait, log }) => {
  let failed = 0;
  let total = 0;
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const name of BOOKS) {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 30000);
    await exec(`(() => { document.getElementById('toc-panel').hidden = true; document.getElementById('btn-toc').click(); app.showSidePanel('toc'); })()`);
    await wait(300);
    const items = await exec(`document.querySelectorAll('.toc-item').length`);
    for (const index of TOC_ITEMS.filter((i) => i < items)) {
      // Click and PageDown in one synchronous block: faster than any human
      const r = JSON.parse(await exec(`(() => {
        document.querySelectorAll('.toc-item')[${index}].click();
        const target = app.activeTab.viewer.getLocation();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        return JSON.stringify({ target });
      })()`));
      await wait(1200);
      const after = JSON.parse(await exec(`JSON.stringify(app.activeTab.viewer.getLocation())`));
      // After PageDown we must be in the same section (or the next one if the section is shorter than the screen), never earlier
      const ok = after.c > r.target.c || (after.c === r.target.c && after.b >= r.target.b);
      total++;
      if (!ok) failed++;
      log(`${ok ? 'OK  ' : 'FAIL'} ${name.slice(0, 12)} зміст[${index}] ціль c${r.target.c}/b${r.target.b} → після PageDown c${after.c}/b${after.b}`);
    }
  }
  log(`RESULT ${total - failed}/${total} passed`);
};
