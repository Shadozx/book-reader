const path = require('node:path');

const BOOKS = ['Diuna.fb2', 'German_Smotret_i_vidit.fb2', 'Platon_Apologiya_Sokrata_Dialogi_1dfc1e_500611.fb2'];

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  for (const [i, name] of BOOKS.entries()) {
    const file = JSON.stringify(path.join(root, 'samples', name));
    const t0 = Date.now();
    await exec(`app.openBook(${file})`);
    await waitFor(`app.activeTab.format && !app.activeTab.paneEl.querySelector('.spinner')`, 60000);
    const ms = Date.now() - t0;
    const info = await exec(`(() => {
      const t = app.activeTab, c = t.paneEl.querySelector('.book-content');
      if (!c) return { error: t.paneEl.innerText };
      return {
        title: t.record.title, author: t.record.author,
        chunks: c.querySelectorAll(':scope > .chunk').length,
        paragraphs: c.querySelectorAll('p').length,
        chars: c.textContent.length,
        images: c.querySelectorAll('img').length,
        brokenImages: [...c.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length,
        noteLinks: c.querySelectorAll('a.note-link').length,
        links: c.querySelectorAll('a[data-href]').length,
        toc: t.viewer.toc.length,
        headings: c.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      };
    })()`);
    log(name, `${ms} ms`, JSON.stringify(info));
    await shot(`fb2-${i}-start`);

    // The first chapter from the TOC
    await exec(`document.getElementById('btn-toc').click()`);
    await exec(`document.querySelectorAll('.toc-item')[Math.min(3, document.querySelectorAll('.toc-item').length - 1)]?.click()`);
    await shot(`fb2-${i}-toc`);
    await exec(`document.getElementById('btn-toc').click()`);

    // Footnote
    const hasNote = await exec(`(() => {
      const c = app.activeTab.paneEl.querySelector('.book-content');
      const a = c.querySelector('a.note-link') || c.querySelector('a[data-href]');
      if (!a) return false;
      a.scrollIntoView({ block: 'center' });
      a.click();
      return !!app.activeTab.paneEl.querySelector('.note-popup');
    })()`);
    log('note popup shown:', hasNote);
    if (hasNote) await shot(`fb2-${i}-note`);
  }
  await exec(`app.setTheme('dark')`);
  await exec(`app.activateTab(app.tabs[0])`);
  await exec(`app.activeTab.paneEl.querySelector('.flow-scroller').scrollTop = 30000`);
  await shot('fb2-dark');
};
