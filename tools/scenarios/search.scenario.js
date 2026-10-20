// Search (Ctrl+F) in all formats: match count, the current match is visible, moving to the next one
const path = require('node:path');

const CASES = [
  ['Diuna.fb2', 'харконнен', 'scroll'],
  ['Diuna.fb2', 'харконнен', 'paged'],
  ['Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub', 'сенека', 'scroll'],
  ['Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf', 'handshake', 'scroll'],
  ['Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu', 'сократ', 'scroll'],
  ['las-cases_eo01-1.djvu', 'наполеон', 'paged'],
];

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  // The current match must be visible in the book view
  const currentVisible = `(() => {
    const h = CSS.highlights.get('search-current');
    if (!h || !h.size) return false;
    const range = [...h][0];
    const r = range.getBoundingClientRect();
    const box = app.activeTab.paneEl.getBoundingClientRect();
    return r.height > 0 && r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
  })()`;
  const count = () => exec(`document.getElementById('search-count').textContent`);

  for (const [i, [name, query, mode]] of CASES.entries()) {
    await exec(`app.updateSettings({ mode: '${mode}' })`);
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 60000);
    await wait(500);
    await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true }))`);
    const opened = await exec(`!document.getElementById('search-bar').hidden && document.activeElement.id === 'search-input'`);
    const t0 = Date.now();
    await exec(`(() => { const el = document.getElementById('search-input'); el.value = ${JSON.stringify(query)}; el.dispatchEvent(new Event('input')); })()`);
    await waitFor(`/^\\d+ \\/ \\d+\\+?$/.test(document.getElementById('search-count').textContent) || document.getElementById('search-count').textContent === 'Не знайдено'`, 60000);
    const ms = Date.now() - t0;
    await waitFor(currentVisible, 10000);
    const first = await count();
    const visible1 = await exec(currentVisible);
    // Next match (Enter)
    await exec(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await waitFor(currentVisible, 10000);
    const second = await count();
    const visible2 = await exec(currentVisible);
    const hits = await exec(`CSS.highlights.get('search-hit')?.size ?? 0`);
    log(`${name.slice(0, 24).padEnd(24)} ${mode.padEnd(6)} bar=${opened} ${ms} ms  ${first} → ${second}  visible=${visible1}/${visible2}  highlighted=${hits}`);
    await shot(`search-${i}`);
    await exec(`document.getElementById('search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    const closed = await exec(`document.getElementById('search-bar').hidden && !CSS.highlights.has('search-hit')`);
    if (!closed) log('  FAIL: Esc не закрив пошук');
  }
};
