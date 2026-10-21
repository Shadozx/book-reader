'use strict';
// Bookmarks of the active book.
//
//   count()            number of bookmarks
//   all()              the saved bookmarks ({ text, chapter, location, … })
//   toggle()           Ctrl+D: adds a bookmark here, or removes the one that is here
//   clickButton()      the bookmark button on the toolbar (same as Ctrl+D)
//   isButtonLit()      whether the button shows that this place has a bookmark

module.exports = ({ exec, wait, act, press }) => ({
  count: () => exec(`(app.activeTab.record.bookmarks ?? []).length`),

  all: () => exec(`app.activeTab.record.bookmarks ?? []`),

  async toggle() {
    await press('d', { ctrl: true });
    await wait(100);
  },

  async clickButton() {
    act('click the bookmark button');
    await exec(`document.getElementById('btn-bookmark').click()`);
    await wait(100);
  },

  isButtonLit: () => exec(`document.getElementById('btn-bookmark').classList.contains('active')`),
});
