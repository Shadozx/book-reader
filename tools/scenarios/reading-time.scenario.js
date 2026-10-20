// Time to the end of the chapter: shown, decreases while reading, speed adapts to the reader
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, wait, shot, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const line = () => exec(`document.getElementById('book-author').textContent.replace(/^.*? · /, '… · ')`);
  const minutes = async () => {
    const l = await line();
    const m = l.match(/ще ≈ (?:(\d+) год ?)?(?:(\d+) хв)?/);
    return m ? (Number(m[1] || 0) * 60 + Number(m[2] || 0)) : null;
  };
  const key = (k) => exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true }))`);

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`(() => { document.getElementById('btn-toc').click(); app.showSidePanel('toc'); document.querySelectorAll('.toc-item')[6].click(); document.getElementById('btn-toc').click(); })()`);
  await wait(500);
  const m1 = await minutes();
  check('показується час до кінця розділу', m1 !== null && m1 > 0, await line());
  for (let i = 0; i < 3; i++) {
    await key('PageDown');
    await wait(400);
  }
  const m2 = await minutes();
  check('час зменшується під час читання', m2 !== null && m2 < m1, `${m1} хв → ${m2} хв`);
  check('підказка пояснює розрахунок', await exec(`document.getElementById('book-author').title.includes('До кінця розділу') && document.getElementById('book-author').title.includes('знаків за хвилину')`));

  // The speed adapts: 2000 characters "read" in a minute
  const before = await exec(`app.store.reading.chars`);
  await exec(`(() => { const t = app.activeTab; const pos = t.viewer.readingPosition(); t.readSample = { ...pos, value: pos.value - 2000, time: Date.now() - 60000 }; app.trackReadingSpeed(t); })()`);
  const after = await exec(`app.store.reading.chars`);
  check('швидкість підлаштовується під читача', after > before && after < 2000, `${Math.round(before)} → ${Math.round(after)} знаків/хв`);

  // A jump (TOC navigation half a book ahead) doesn't spoil the speed
  await exec(`(() => { const t = app.activeTab; const pos = t.viewer.readingPosition(); t.readSample = { ...pos, value: pos.value - 400000, time: Date.now() - 60000 }; app.trackReadingSpeed(t); })()`);
  check('стрибок не враховується', Math.abs((await exec(`app.store.reading.chars`)) - after) < 0.001);
  // Going back isn't counted either
  await exec(`(() => { const t = app.activeTab; const pos = t.viewer.readingPosition(); t.readSample = { ...pos, value: pos.value + 3000, time: Date.now() - 60000 }; app.trackReadingSpeed(t); })()`);
  check('повернення назад не враховується', Math.abs((await exec(`app.store.reading.chars`)) - after) < 0.001);
  await shot('reading-time-fb2');

  // Formatting
  check('формат часу', await exec(`[app.formatMinutes(0.4), app.formatMinutes(12.4), app.formatMinutes(75), app.formatMinutes(120)].join(' | ')`) === 'менше хвилини | ≈ 12 хв | ≈ 1 год 15 хв | ≈ 2 год',
    await exec(`[app.formatMinutes(0.4), app.formatMinutes(12.4), app.formatMinutes(75), app.formatMinutes(120)].join(' | ')`));

  // DjVu: time in pages
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu'))})`);
  await waitFor(`app.activeTab.viewer && app.activeTab.viewer.toc.length > 0`, 30000);
  await exec(`app.activeTab.viewer.goTo({ page: 150, f: 0 })`);
  await wait(800);
  check('DjVu: час до кінця розділу за сторінками', /стор\. \d+ з \d+ · ще (≈|менше)/.test(await line()), await line());
  check('DjVu: підказка про хвилини на сторінку', await exec(`document.getElementById('book-author').title.includes('хв на сторінку')`));

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
