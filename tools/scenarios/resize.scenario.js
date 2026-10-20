// Do text and images fit into windows of different sizes (both modes)
const path = require('node:path');

const BOOKS = [
  'German_Smotret_i_vidit.fb2',                                        // FB2, 73 images
  'Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub',      // EPUB
  'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf',  // PDF
  'las-cases_eo01-1.djvu',                                             // DjVu
];
const SIZES = [[1280, 860], [800, 600], [520, 400]];

// Checks inside the window: returns a list of problems
const CHECK = `(() => {
  const problems = [];
  const pane = app.activeTab.paneEl;
  const bar = document.getElementById('toolbar');
  if (bar.scrollWidth > bar.clientWidth + 1) problems.push('панель інструментів не вміщається: ' + bar.scrollWidth + ' > ' + bar.clientWidth);
  // Кожна видима кнопка/напис панелі має повністю вміщатися (а не стискатися чи обрізатися)
  const barRight = bar.getBoundingClientRect().right;
  for (const el of bar.querySelectorAll('button, select, #progress')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.right > barRight + 1) problems.push('елемент панелі за краєм вікна: ' + (el.id || el.title || el.tagName));
    if (el.id === 'progress' && el.scrollWidth > el.clientWidth + 1) problems.push('лічильник сторінок обрізаний');
    if (el.tagName === 'BUTTON' && r.width < 24) problems.push('кнопка стиснута: ' + (el.id || el.title));
  }
  const tabs = document.getElementById('tabbar');
  if (tabs.scrollWidth > tabs.clientWidth + 1) problems.push('рядок вкладок ширший за вікно');
  const v = app.activeTab.viewer;
  if (v.kind === 'flow') {
    const paged = pane.querySelector('.flow').classList.contains('paged');
    if (!paged) {
      const sc = pane.querySelector('.flow-scroller');
      if (sc.scrollWidth > sc.clientWidth + 1) problems.push('горизонтальна прокрутка тексту: ' + sc.scrollWidth + ' > ' + sc.clientWidth);
      const content = pane.querySelector('.flow-scroller .book-content');
      const cs = getComputedStyle(content);
      const inner = content.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      let checked = 0;
      for (const img of content.querySelectorAll('img')) {
        const r = img.getBoundingClientRect();
        if (!r.width) continue;
        checked++;
        if (r.width > inner + 1) problems.push('картинка ширша за колонку: ' + Math.round(r.width) + ' > ' + Math.round(inner));
      }
      for (const el of content.querySelectorAll('table, pre')) {
        if (el.getBoundingClientRect().width > inner + 1) problems.push(el.tagName + ' ширша за колонку');
      }
      return { mode: 'scroll', imagesChecked: checked, problems };
    }
    const clip = pane.querySelector('.page-clip').getBoundingClientRect();
    let checked = 0;
    for (const img of pane.querySelectorAll('.page-strip img')) {
      const r = img.getBoundingClientRect();
      if (!r.width) continue;
      checked++;
      if (r.height > clip.height + 1) problems.push('картинка вища за сторінку: ' + Math.round(r.height) + ' > ' + Math.round(clip.height));
      if (r.width > (clip.width / (pane.querySelector('.page-strip').style.columnCount || 1)) + 1) problems.push('картинка ширша за колонку');
    }
    if (clip.left < 0 || clip.right > pane.getBoundingClientRect().right + 1) problems.push('сторінка виходить за вікно');
    return { mode: 'paged', imagesChecked: checked, problems };
  }
  // PDF / DjVu
  const sc = pane.querySelector('.fixed-scroller');
  const page = pane.querySelector('.fixed-page:not(.off)');
  const zoom = v.zoomValue;
  if (['auto', 'width', 'page'].includes(zoom) && sc.scrollWidth > sc.clientWidth + 1) problems.push('сторінка ширша за вікно при масштабі ' + zoom);
  const visible = [...pane.querySelectorAll('.fixed-page:not(.off)')].filter(p => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  if (zoom === 'page') for (const p of visible) if (p.getBoundingClientRect().height > sc.clientHeight + 1) problems.push('сторінка вища за вікно при масштабі «цілком»');
  return { mode: v.progress().text.includes('–') ? 'paged(spread)' : 'zoom ' + zoom, problems };
})()`;

module.exports = async ({ root, exec, waitFor, shot, wait, resize, log }) => {
  let total = 0;
  for (const [bi, name] of BOOKS.entries()) {
    resize(1280, 860);
    await exec(`app.updateSettings({ mode: 'scroll' })`);
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.viewer`, 60000);
    // For FB2/EPUB go to a chapter with images so there is something to check in paged mode
    await exec(`(() => { const v = app.activeTab.viewer; if (v.kind !== 'flow') return v.goTo({ page: 20, f: 0 }); const img = [...app.activeTab.paneEl.querySelectorAll('.book-content .chunk:not(.cover-chunk) img')][3]; const chunk = img?.closest('[data-id]'); if (chunk) v.goTo({ id: chunk.dataset.id }); })()`);
    for (const [w, h] of SIZES) {
      resize(w, h);
      for (const mode of ['scroll', 'paged']) {
        await exec(`app.updateSettings({ mode: '${mode}' })`);
        await wait(700);
        const r = await exec(`JSON.stringify(${CHECK})`);
        const parsed = JSON.parse(r);
        total += parsed.problems.length;
        log(`${name.slice(0, 22).padEnd(22)} ${String(w + 'x' + h).padEnd(9)} ${mode.padEnd(6)}`, r);
        if (w === 520) await shot(`resize-${bi}-${mode}-${w}`);
      }
    }
  }
  log('TOTAL PROBLEMS', total);
};
