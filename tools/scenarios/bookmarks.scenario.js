// Bookmarks in a text book and in a PDF, and after a restart

module.exports = [
  // First run
  async ({ step, reader, bookmarks, sidePanel, check, t }) => {
    let marked;

    await step('A new book has no bookmarks', async () => {
      await reader.setMode('scroll');
      await reader.open('fb2');
      check('no bookmarks yet', (await bookmarks.count()) === 0);
      check('the bookmark button is not lit', !(await bookmarks.isButtonLit()));
    });

    await step('Ctrl+D adds a bookmark here', async () => {
      await reader.goToContentsItem(8);
      marked = await reader.location();
      await bookmarks.toggle();
      check('one bookmark', (await bookmarks.count()) === 1);
      check('the bookmark button is lit', await bookmarks.isButtonLit());
      const [bookmark] = await bookmarks.all();
      check('it is named by its chapter and text', bookmark.chapter.length > 0 && bookmark.text.length > 10, `${bookmark.chapter}: ${bookmark.text.slice(0, 40)}…`);
    });

    await step('Elsewhere in the book the button is not lit', async () => {
      await reader.goToContentsItem(20);
      check('the bookmark button is not lit', !(await bookmarks.isButtonLit()));
    });

    await step('The bookmark is in the side panel and leads back', async () => {
      await sidePanel.open('bookmarks');
      check('one entry in the list', (await sidePanel.itemCount('bookmarks')) === 1);
      await sidePanel.clickItem('bookmarks', 0);
      const back = await reader.location();
      check('back at the bookmarked place', reader.samePlace(back, marked), `${JSON.stringify(marked)} → ${JSON.stringify(back)}`);
    });

    await step('Ctrl+D on the same place removes the bookmark', async () => {
      await bookmarks.toggle();
      check('no bookmarks', (await bookmarks.count()) === 0);
      check('the list is empty', (await sidePanel.itemCount('bookmarks')) === 0);
      check('the bookmark button is not lit', !(await bookmarks.isButtonLit()));
    });

    await step('Add the bookmark again, to check it after a restart', async () => {
      await bookmarks.toggle();
      check('one bookmark', (await bookmarks.count()) === 1);
    });

    await step('A PDF bookmark is named by its page', async () => {
      await reader.open('pdf');
      const page = Math.floor((await reader.pageCount()) / 2);
      await reader.goToPage(page);
      await bookmarks.clickButton();
      const [bookmark] = await bookmarks.all();
      check('named "page N"', bookmark?.text === t('bookmark.page', { n: page + 1 }), bookmark?.text);
    });

    await step('A book without contents opens the side panel on bookmarks', async () => {
      await sidePanel.openWithButton();
      check('the bookmarks tab is shown', (await sidePanel.shownTab()) === 'bookmarks');
    });
  },

  // After a restart
  async ({ step, exec, waitFor, check }) => {
    await step('Both bookmarks are still there', async () => {
      await waitFor(`app.tabs.length === 2 && app.tabs.every((t) => t.viewer)`, 60000);
      const counts = await exec(`app.tabs.map((t) => t.format + ':' + (t.record.bookmarks ?? []).length).join()`);
      check('one bookmark in the FB2 and one in the PDF', counts === 'fb2:1,pdf:1', counts);
    });
  },
];

module.exports.title = 'Bookmarks in a text book and in a PDF, and after a restart';
