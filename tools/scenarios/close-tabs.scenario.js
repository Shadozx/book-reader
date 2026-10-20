// Closing tabs with real mouse clicks (close button, middle button) and Ctrl+W;
// also checks that PDF pages are rendered in the dark theme in paged mode
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, wait, shot, log, click }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const tabCount = () => exec(`app.tabs.length + ' / DOM ' + document.querySelectorAll('#tabs .tab').length`);
  // Element center in window coordinates
  const center = (selector) => exec(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]); })()`).then(JSON.parse);

  await exec(`app.updateSettings({ theme: 'dark', mode: 'paged' })`);
  for (const name of ['German_Smotret_i_vidit.fb2', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf', 'Diuna.fb2']) {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 30000);
  }
  // PDF: "Fit page", pages 6–7
  await exec(`app.activateTab(app.tabs[1])`);
  await exec(`app.activeTab.viewer.setZoom('page')`);
  await exec(`app.activeTab.viewer.goTo({ page: 5, f: 0 })`);
  await wait(2000);
  const blank = await exec(`(() => {
    const out = [];
    for (const p of app.activeTab.paneEl.querySelectorAll('.fixed-page:not(.off)')) {
      const c = p.querySelector('canvas');
      if (!c) { out.push(p.dataset.num + ': немає полотна'); continue; }
      const s = document.createElement('canvas'); s.width = 32; s.height = 32;
      const ctx = s.getContext('2d'); ctx.drawImage(c, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data; let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      out.push(p.dataset.num + ': середня яскравість ' + Math.round(sum / (d.length / 4) / 3));
    }
    return out.join('; ');
  })()`);
  check('сторінки PDF намальовані (не чорні)', !/яскравість (\d|[1-4]\d)\b/.test(blank) && !blank.includes('немає'), blank);
  await shot('close-01-pdf-dark-paged');

  log('вкладок до закриття:', await tabCount());
  // 1) Close button on an inactive tab (the second FB2 book)
  const [x1, y1] = await center('#tabs .tab:nth-child(1) .icon-btn');
  await click(x1, y1);
  await wait(400);
  check('хрестик на неактивній вкладці', (await tabCount()).startsWith('2 / DOM 2'), await tabCount());
  // 2) Close button on the active tab (PDF)
  await exec(`app.activateTab(app.tabs[0])`);
  const [x2, y2] = await center('#tabs .tab.active .icon-btn');
  await click(x2, y2);
  await wait(400);
  check('хрестик на активній вкладці', (await tabCount()).startsWith('1 / DOM 1'), await tabCount());
  // 3) Ctrl+W
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Platon_Apologiya_Sokrata_Dialogi_1dfc1e_500611.fb2'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true }))`);
  await wait(400);
  check('Ctrl+W', (await tabCount()).startsWith('1 / DOM 1'), await tabCount());
  // 4) Middle mouse button
  const [x3, y3] = await center('#tabs .tab .tab-title');
  await click(x3, y3, 'middle');
  await wait(400);
  check('середня кнопка миші', (await tabCount()).startsWith('0 / DOM 0'), await tabCount());

  // 5) Every format closes without console errors
  for (const name of ['Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub', 'Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf', 'Diuna.fb2']) {
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 30000);
    await wait(500);
    const [x, y] = await center('#tabs .tab.active .icon-btn');
    await click(x, y);
    await wait(300);
    check(`закриття вкладки ${name.split('.').pop().toUpperCase()}`, (await tabCount()).startsWith('0 / DOM 0'), await tabCount());
  }
  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
