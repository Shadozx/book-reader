// PDF and DjVu: opening, drawing pages, table of contents, text layer, going to a page,
// paged mode with spreads, zoom. The generated PDF always; real scans and DjVu if the optional samples are there.

const BOOKS = [
  { role: 'pdf', text: true },
  { role: 'pdfScan' },
  { role: 'djvu', text: true, toc: true },
  { role: 'djvuLarge', toc: true },
  { role: 'djvuExtra' },
];

module.exports = async ({ open, exec, waitFor, check, skip, has, press, pagesReady, location, shot, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const book of BOOKS) {
    if (!has(book.role)) {
      skip(`${book.role}: no optional sample book`);
      continue;
    }
    const started = Date.now();
    await open(book.role);
    const opened = Date.now() - started;
    check(`${book.role}: the first pages are drawn`, await pagesReady(), `opened in ${opened} ms, drawn in ${Date.now() - started} ms`);
    const pages = await exec(`app.activeTab.viewer.pageCount`);
    check(`${book.role}: page count`, pages > 1, `${pages} pages`);
    if (book.toc) {
      // DjVu reads its table of contents in the background
      check(`${book.role}: table of contents`, await waitFor(`app.activeTab.viewer.toc.length > 0`, 30000), `${await exec(`app.activeTab.viewer.toc.length`)} entries`);
    }
    await shot(`pages-${book.role}-1-start`);

    // Go to the middle of the book
    const middle = Math.floor(pages / 2);
    await exec(`app.activeTab.viewer.goTo({ page: ${middle}, f: 0 })`);
    await pagesReady();
    check(`${book.role}: going to a page`, (await location()).page === middle, `page ${middle + 1}`);
    if (book.text) {
      const words = await exec(`app.activeTab.paneEl.querySelectorAll('.fixed-page[data-num="${middle + 1}"] .textLayer span, .fixed-page[data-num="${middle + 1}"] .djvuTextLayer span').length`);
      check(`${book.role}: text layer`, words > 0, `${words} pieces of text on page ${middle + 1}`);
    }
    await shot(`pages-${book.role}-2-middle`);

    // Paged mode: two pages side by side on a wide window, → turns a whole spread
    await exec(`app.updateSettings({ mode: 'paged' })`);
    await pagesReady();
    const spread = await exec(`app.activeTab.viewer.progress().text`);
    check(`${book.role}: paged mode shows a spread`, spread.includes('–'), spread);
    const before = (await location()).page;
    await press('ArrowRight');
    await pagesReady();
    const after = (await location()).page;
    check(`${book.role}: → turns the spread`, after === before + 2, `page ${before + 1} → ${after + 1}`);
    await exec(`app.setTheme('dark')`);
    await shot(`pages-${book.role}-3-paged-dark`);
    await exec(`app.setTheme('light')`);

    // Zoom
    await exec(`app.updateSettings({ mode: 'scroll' })`);
    const scale = await exec(`app.activeTab.viewer.scale`);
    await exec(`app.activeTab.viewer.zoomIn()`);
    await pagesReady();
    const zoomed = await exec(`app.activeTab.viewer.scale`);
    check(`${book.role}: zoom in`, zoomed > scale, `${scale.toFixed(2)} → ${zoomed.toFixed(2)}`);
    await exec(`app.activeTab.viewer.setZoom('width')`);
    await pagesReady();
    check(`${book.role}: fit width`, await exec(`app.activeTab.viewer.zoomValue === 'width' && document.getElementById('zoom-select').value === 'width'`));
  }
  log('memory', JSON.stringify(await exec(`({ usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), canvases: document.querySelectorAll('canvas').length })`)));
};
