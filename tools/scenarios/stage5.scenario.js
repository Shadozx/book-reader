// PDF and DjVu: opening, rendering, TOC, text layer, links, modes, dark theme
const path = require('node:path');

const BOOKS = [
  'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf',
  'Чандлер Д. Военные кампании Наполеона (1999), OCR.pdf',
  'Ksenofont__Vospominaniya_o_Sokrate._Readli.Net_260732_original_06a60.djvu',
  'las-cases_eo01-1.djvu',
  'las-cases_eo01-2-1.djvu',
];

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  const pane = `app.activeTab.paneEl`;
  // Wait until all visible pages are rendered
  const settle = async (timeout = 30000) => {
    await wait(150);
    const t0 = Date.now();
    await waitFor(`(() => { const ps = [...${pane}.querySelectorAll('.fixed-page:not(.off)')].filter(p => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }); return ps.length > 0 && ps.every(p => p.querySelector('canvas') && !p.classList.contains('loading')); })()`, timeout);
    return Date.now() - t0;
  };
  const state = () => exec(`JSON.stringify({ loc: app.activeTab.viewer.getLocation(), p: app.activeTab.viewer.progress().text, scale: +app.activeTab.viewer.scale.toFixed(3) })`);

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const [i, name] of BOOKS.entries()) {
    const t0 = Date.now();
    await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', name))})`);
    await waitFor(`app.activeTab.format && !${pane}.querySelector('.spinner')`, 120000);
    const openMs = Date.now() - t0;
    const err = await exec(`${pane}.querySelector('.pane-message.error')?.innerText ?? null`);
    if (err) { log(name, 'ERROR', err); continue; }
    const firstMs = await settle(60000);
    const info = await exec(`(() => {
      const v = app.activeTab.viewer, el = ${pane};
      const flat = []; const walk = (a) => a.forEach(x => { flat.push(x); x.children && walk(x.children); }); walk(v.toc);
      return JSON.stringify({
        title: app.activeTab.record.title, pages: el.querySelectorAll('.fixed-page').length,
        toc: flat.length, tocFirst: flat.slice(0, 3).map(x => x.label),
        canvases: el.querySelectorAll('canvas').length,
        textSpans: el.querySelectorAll('.textLayer span').length,
        links: el.querySelectorAll('.page-link').length,
      });
    })()`);
    log(`${name.slice(0, 32).padEnd(32)} open ${openMs} ms, first page +${firstMs} ms`, info);
    await shot(`fx-${i}-1-start`);

    // Middle of the book
    const t1 = Date.now();
    await exec(`app.activeTab.viewer.goTo({ page: Math.floor(${pane}.querySelectorAll('.fixed-page').length / 2), f: 0 })`);
    const midMs = await settle(60000);
    log('  middle page', `${Date.now() - t1} ms`, await state());
    await shot(`fx-${i}-2-middle`);

    // Paged, spread
    await exec(`app.updateSettings({ mode: 'paged' })`);
    await settle();
    log('  paged', await state());
    await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
    await settle();
    log('  paged +1', await state());
    await exec(`app.setTheme('dark')`);
    await shot(`fx-${i}-3-paged-dark`);
    await exec(`app.setTheme('light')`);

    // Zoom
    await exec(`app.updateSettings({ mode: 'scroll' })`);
    await exec(`app.activeTab.viewer.zoomIn()`);
    await settle();
    log('  zoom in', await state());
    await exec(`app.activeTab.viewer.setZoom('width')`);
    await settle();
    log('  back to scroll/width', await state());
  }
  log('memory', await exec(`JSON.stringify({ usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), canvases: document.querySelectorAll('canvas').length })`));
};
