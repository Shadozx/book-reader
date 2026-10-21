// Bookmarks: none at first, Ctrl+D adds one, it's in the side panel and leads back to its place,
// a second Ctrl+D removes it; PDF bookmarks are named by page; bookmarks survive a restart.

module.exports = [
  async ({ open, exec, wait, check, press, tocItem, location, t, shot }) => {
    const count = () => exec(`(app.activeTab.record.bookmarks ?? []).length`);
    const highlighted = () => exec(`document.getElementById('btn-bookmark').classList.contains('active')`);
    const listed = () => exec(`document.querySelectorAll('#bookmark-list .bookmark-item').length`);

    await exec(`app.updateSettings({ mode: 'scroll' })`);
    await open('fb2');
    check('a new book has no bookmarks', (await count()) === 0 && !(await highlighted()));

    await tocItem(8);
    await wait(700);
    const marked = await location();
    await press('d', { ctrl: true });
    check('Ctrl+D adds a bookmark', (await count()) === 1);
    check('the bookmark button lights up', await highlighted());
    check('the bookmark is labelled with its chapter and text', await exec(`(() => { const b = app.activeTab.record.bookmarks[0]; return b.chapter.length > 0 && b.text.length > 10; })()`));

    await tocItem(20);
    await wait(600);
    check('elsewhere the button is not lit', !(await highlighted()));
    await exec(`app.showSidePanel('bookmarks')`);
    check('the bookmark is listed in the side panel', (await listed()) === 1);
    await shot('bookmarks-01-panel');

    await exec(`document.querySelector('#bookmark-list .bookmark-item').click()`);
    await wait(700);
    const back = await location();
    check('a click on the bookmark returns to its place', back.c === marked.c && back.b === marked.b, `${JSON.stringify(marked)} → ${JSON.stringify(back)}`);

    await press('d', { ctrl: true });
    check('Ctrl+D on the same place removes the bookmark', (await count()) === 0 && (await listed()) === 0 && !(await highlighted()));
    await press('d', { ctrl: true });   // one bookmark stays for the restart check

    // PDF: named by page; a book without contents opens the side panel on bookmarks
    await open('pdf');
    const page = Math.floor((await exec(`app.activeTab.viewer.pageCount`)) / 2);
    await exec(`app.activeTab.viewer.goTo({ page: ${page}, f: 0 })`);
    await wait(500);
    await exec(`document.getElementById('btn-bookmark').click()`);
    const label = await exec(`app.activeTab.record.bookmarks?.[0]?.text`);
    check('a PDF bookmark is named by its page', label === t('bookmark.page', { n: page + 1 }), label);
    check('without contents the side panel opens on bookmarks', await exec(`(() => { document.getElementById('toc-panel').hidden = true; document.getElementById('btn-toc').click(); return !document.getElementById('bookmark-list').hidden; })()`));
    await shot('bookmarks-02-pdf');
  },

  // After a restart
  async ({ exec, waitFor, check }) => {
    await waitFor(`app.tabs.length === 2 && app.tabs.every((t) => t.viewer)`, 60000);
    const counts = await exec(`app.tabs.map((t) => t.format + ':' + (t.record.bookmarks ?? []).length).join()`);
    check('after a restart: both bookmarks are still there', counts === 'fb2:1,pdf:1', counts);
  },
];
