const path = require('node:path');

const BOOKS = ['Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub', 'Відьмак-Час-Погорди-Т4-Анджей-Сапковський-2996627e-1.epub'];

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const [i, name] of BOOKS.entries()) {
    const file = JSON.stringify(path.join(root, 'samples', name));
    const t0 = Date.now();
    await exec(`app.openBook(${file})`);
    await waitFor(`app.activeTab.format && !app.activeTab.paneEl.querySelector('.spinner')`, 60000);
    const ms = Date.now() - t0;
    const info = await exec(`(() => {
      const t = app.activeTab, c = t.paneEl.querySelector('.book-content');
      if (!c) return { error: t.paneEl.innerText };
      const style = document.querySelector('style[data-book]');
      return {
        title: t.record.title, author: t.record.author, lang: t.viewer.meta.lang,
        chunks: c.querySelectorAll(':scope > .chunk').length,
        paragraphs: c.querySelectorAll('p').length,
        chars: c.textContent.length,
        images: c.querySelectorAll('img, image').length,
        unresolvedImages: c.querySelectorAll('[data-res]').length,
        noteLinks: c.querySelectorAll('a.note-link').length,
        links: c.querySelectorAll('a[data-href]').length,
        brokenLinks: [...c.querySelectorAll('a[data-href]')].filter(a => !c.querySelector('[data-id="' + CSS.escape(a.dataset.href) + '"]')).length,
        toc: t.viewer.toc.length,
        tocTopLabels: t.viewer.toc.slice(0, 4).map(x => x.label),
        cssBytes: style?.textContent.length,
        dangerous: c.querySelectorAll('script, iframe, object, embed, form, [onclick], [onload]').length,
      };
    })()`);
    log(name.slice(0, 40), `${ms} ms`, JSON.stringify(info));
    await shot(`epub-${i}-start`);

    await exec(`document.getElementById('btn-toc').click()`);
    await exec(`document.querySelectorAll('.toc-item')[Math.min(4, document.querySelectorAll('.toc-item').length - 1)]?.click()`);
    await wait(700);
    await shot(`epub-${i}-toc`);
    await exec(`document.getElementById('btn-toc').click()`);

    const note = await exec(`(() => {
      const c = app.activeTab.paneEl.querySelector('.book-content');
      const a = c.querySelector('a.note-link') || [...c.querySelectorAll('a.maybe-note')].find(x => { const t = c.querySelector('[data-id="' + CSS.escape(x.dataset.href) + '"]'); return t && !t.closest('h1,h2,h3,h4,h5,h6'); });
      if (!a) return 'no note links';
      a.scrollIntoView({ block: 'center' });
      a.click();
      const p = app.activeTab.paneEl.querySelector('.note-popup');
      return p ? 'popup: ' + p.querySelector('.note-body').textContent.trim().length + ' chars' : 'no popup (href=' + a.dataset.href + ')';
    })()`);
    log('note', note);
    if (String(note).startsWith('popup')) await shot(`epub-${i}-note`);

    await exec(`app.updateSettings({ mode: 'paged' })`);
    await wait(300);
    await shot(`epub-${i}-paged`);
    await exec(`app.setTheme('dark')`);
    await shot(`epub-${i}-paged-dark`);
    await exec(`app.setTheme('light')`);
    await exec(`app.updateSettings({ mode: 'scroll' })`);
  }
};
