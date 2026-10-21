'use strict';
// Reading: opening books, the reading position, moving through a book, the reading mode.
//
//   open(role)                    opens a test book and waits until it's shown
//   location()                    the reading position: { c, b, f } in FB2/EPUB, { page, f } in PDF/DjVu
//   samePlace(a, b, slack)        whether two positions are the same place (slack: paragraphs apart)
//   goToContentsItem(index)       jumps to a table of contents entry, like a click in the side panel
//   goToPage(index)               PDF/DjVu: shows a page (0-based)
//   pageCount()                   PDF/DjVu: number of pages
//   turnPages(n), pageDown(n)     → / PageDown n times (negative n goes back)
//   setMode('scroll' | 'paged')   the reading mode
//   pagesReady()                  waits until the visible PDF/DjVu pages are drawn

module.exports = ({ exec, wait, waitFor, act, press, book }) => {
  const reader = {
    async open(role, { timeout = 60000 } = {}) {
      const file = book(role);
      act(`open book "${role}" (${file.split(/[\\/]/).pop()})`);
      await exec(`app.openBook(${JSON.stringify(file)})`);
      const ok = await waitFor(`app.activeTab?.path === ${JSON.stringify(file)} && !!app.activeTab.viewer`, timeout);
      if (!ok) {
        const error = await exec(`app.activeTab?.paneEl.querySelector('.pane-message.error')?.innerText ?? null`);
        throw new Error(`Could not open the "${role}" book${error ? ': ' + error : ''}`);
      }
      return file;
    },

    location: () => exec(`app.activeTab.viewer.getLocation()`),

    samePlace(a, b, slack = 0) {
      if (Number.isInteger(a.page)) return a.page === b.page;
      return a.c === b.c && Math.abs(a.b - b.b) <= slack;
    },

    async goToContentsItem(index, { settle = 600 } = {}) {
      act(`go to contents entry ${index + 1}`);
      await exec(`(() => {
        const panel = document.getElementById('toc-panel');
        const wasHidden = panel.hidden;
        if (wasHidden) document.getElementById('btn-toc').click();
        app.showSidePanel('toc');
        document.querySelectorAll('.toc-item')[${index}].click();
        if (wasHidden) document.getElementById('btn-toc').click();
      })()`);
      if (settle) await wait(settle);
    },

    async goToPage(index) {
      act(`go to page ${index + 1}`);
      await exec(`app.activeTab.viewer.goTo({ page: ${index}, f: 0 })`);
      await reader.pagesReady();
    },

    pageCount: () => exec(`app.activeTab.viewer.pageCount`),

    async turnPages(n) {
      act(`turn ${Math.abs(n)} page${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'forward' : 'back'}`);
      for (let i = 0; i < Math.abs(n); i++) await press(n > 0 ? 'ArrowRight' : 'ArrowLeft', { quiet: true });
      await wait(600);
    },

    async pageDown(n) {
      act(`press ${n > 0 ? 'PageDown' : 'PageUp'} ${Math.abs(n)} time${Math.abs(n) === 1 ? '' : 's'}`);
      for (let i = 0; i < Math.abs(n); i++) await press(n > 0 ? 'PageDown' : 'PageUp', { quiet: true });
      await wait(600);
    },

    async setMode(mode) {
      act(`switch to ${mode} mode`);
      await exec(`app.updateSettings({ mode: '${mode}' })`);
      await wait(600);
    },

    // Visible pages of the active PDF/DjVu tab have their canvases drawn
    async pagesReady(timeout = 60000) {
      await wait(150);
      return waitFor(`(() => {
        const pages = [...app.activeTab.paneEl.querySelectorAll('.fixed-page:not(.off)')]
          .filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
        return pages.length > 0 && pages.every((p) => p.querySelector('canvas') && !p.classList.contains('loading'));
      })()`, timeout);
    },
  };
  return reader;
};
