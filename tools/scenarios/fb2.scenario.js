// FB2: parsing (text, images, table of contents, footnotes), jumping through the contents, footnote popups

const BOOKS = [
  { role: 'fb2', notes: true },
  { role: 'fb2Images', notes: true, images: true },
  { role: 'fb2Extra' },
];

module.exports = async ({ open, exec, waitFor, check, tocItem, location, shot, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const book of BOOKS) {
    const started = Date.now();
    await open(book.role);
    log(`${book.role}: opened in ${Date.now() - started} ms`);

    const info = await exec(`(() => {
      const content = app.activeTab.paneEl.querySelector('.book-content');
      const images = [...content.querySelectorAll('img')];
      return {
        title: app.activeTab.record.title,
        chunks: content.querySelectorAll(':scope > .chunk').length,
        paragraphs: content.querySelectorAll('p').length,
        images: images.length,
        brokenImages: images.filter((i) => i.complete && i.naturalWidth === 0).length,
        noteLinks: content.querySelectorAll('a.note-link').length,
        toc: app.activeTab.viewer.toc.length,
      };
    })()`);
    log(`${book.role}: ${JSON.stringify(info)}`);
    check(`${book.role}: title and text are read`, info.title && info.chunks > 0 && info.paragraphs > 100, `${info.chunks} parts, ${info.paragraphs} paragraphs`);
    check(`${book.role}: table of contents`, info.toc > 0, `${info.toc} entries`);
    check(`${book.role}: no broken images`, info.brokenImages === 0, `${info.images} images, ${info.brokenImages} broken`);
    if (book.images) check(`${book.role}: images are shown`, info.images > 10, `${info.images} images`);
    await shot(`fb2-${book.role}-start`);

    // A jump through the contents moves the reading position
    const before = await location();
    await tocItem(Math.min(3, info.toc - 1));
    await waitFor(`app.activeTab.viewer.getLocation().c !== ${before.c}`, 5000);
    check(`${book.role}: a contents entry moves to its chapter`, (await location()).c !== before.c);

    // A footnote link opens the note in a popup
    if (book.notes) {
      const popup = await exec(`(() => {
        const link = app.activeTab.paneEl.querySelector('.book-content a.note-link');
        if (!link) return false;
        link.scrollIntoView({ block: 'center' });
        link.click();
        return !!app.activeTab.paneEl.querySelector('.note-popup .note-body')?.textContent.trim();
      })()`);
      check(`${book.role}: footnote opens in a popup`, popup, `${info.noteLinks} footnote links`);
      if (popup) await shot(`fb2-${book.role}-note`);
    }
  }
};
