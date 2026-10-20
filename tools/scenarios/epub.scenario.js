// EPUB: parsing (text, images, table of contents, book styles), safe markup, footnotes, paged mode

const BOOKS = [
  { role: 'epub', notes: true },
  { role: 'epubExtra' },
];

module.exports = async ({ open, exec, waitFor, wait, check, tocItem, location, shot, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const book of BOOKS) {
    const started = Date.now();
    await open(book.role);
    log(`${book.role}: opened in ${Date.now() - started} ms`);

    const info = await exec(`(() => {
      const content = app.activeTab.paneEl.querySelector('.book-content');
      return {
        title: app.activeTab.record.title,
        chunks: content.querySelectorAll(':scope > .chunk').length,
        paragraphs: content.querySelectorAll('p').length,
        unresolvedImages: content.querySelectorAll('[data-res]').length,
        links: content.querySelectorAll('a[data-href]').length,
        brokenLinks: [...content.querySelectorAll('a[data-href]')].filter((a) => !content.querySelector('[data-id="' + CSS.escape(a.dataset.href) + '"]')).length,
        toc: app.activeTab.viewer.toc.length,
        dangerous: content.querySelectorAll('script, iframe, object, embed, form, [onclick], [onload]').length,
      };
    })()`);
    log(`${book.role}: ${JSON.stringify(info)}`);
    check(`${book.role}: title and text are read`, info.title && info.chunks > 0 && info.paragraphs > 50, `${info.chunks} parts, ${info.paragraphs} paragraphs`);
    check(`${book.role}: table of contents`, info.toc > 0, `${info.toc} entries`);
    check(`${book.role}: all images are resolved`, info.unresolvedImages === 0);
    check(`${book.role}: no scripts or other unsafe markup`, info.dangerous === 0);
    await shot(`epub-${book.role}-start`);

    const before = await location();
    await tocItem(Math.min(4, info.toc - 1));
    await waitFor(`app.activeTab.viewer.getLocation().c !== ${before.c}`, 5000);
    check(`${book.role}: a contents entry moves to its chapter`, (await location()).c !== before.c);

    if (book.notes) {
      const popup = await exec(`(() => {
        const content = app.activeTab.paneEl.querySelector('.book-content');
        const isNote = (a) => { const t = content.querySelector('[data-id="' + CSS.escape(a.dataset.href) + '"]'); return t && !t.closest('h1,h2,h3,h4,h5,h6'); };
        const link = content.querySelector('a.note-link') || [...content.querySelectorAll('a.maybe-note')].find(isNote);
        if (!link) return false;
        link.scrollIntoView({ block: 'center' });
        link.click();
        return !!app.activeTab.paneEl.querySelector('.note-popup .note-body')?.textContent.trim();
      })()`);
      check(`${book.role}: footnote opens in a popup`, popup);
    }

    await exec(`app.updateSettings({ mode: 'paged' })`);
    await wait(400);
    check(`${book.role}: paged mode shows pages`, await exec(`app.activeTab.paneEl.querySelector('.flow').classList.contains('paged') && /\\d/.test(app.activeTab.viewer.progress().text)`), await exec(`app.activeTab.viewer.progress().text`));
    await exec(`app.setTheme('dark')`);
    await shot(`epub-${book.role}-paged-dark`);
    await exec(`app.setTheme('light')`);
    await exec(`app.updateSettings({ mode: 'scroll' })`);
  }
};
