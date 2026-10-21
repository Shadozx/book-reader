'use strict';
// The side panel (Ctrl+B) with its tabs: 'toc' (contents) and 'bookmarks'.
//
//   open(tab)                 shows the panel on that tab
//   openWithButton()          clicks the panel button, as a user does
//   close()                   hides the panel
//   shownTab()                which tab is shown, or null if the panel is hidden
//   itemCount(tab)            number of entries in that tab
//   clickItem(tab, index)     clicks an entry

const LISTS = { toc: '#toc-list .toc-item', bookmarks: '#bookmark-list .bookmark-item' };

module.exports = ({ exec, wait, act }) => {
  const panel = {
    async open(tab) {
      act(`open the side panel on "${tab}"`);
      await exec(`(() => {
        if (document.getElementById('toc-panel').hidden) document.getElementById('btn-toc').click();
        app.showSidePanel('${tab}');
      })()`);
    },

    async openWithButton() {
      act('click the side panel button');
      await exec(`(() => { document.getElementById('toc-panel').hidden = true; document.getElementById('btn-toc').click(); })()`);
    },

    async close() {
      act('close the side panel');
      await exec(`(() => { if (!document.getElementById('toc-panel').hidden) document.getElementById('btn-toc').click(); })()`);
    },

    shownTab: () => exec(`(() => {
      if (document.getElementById('toc-panel').hidden) return null;
      return document.getElementById('toc-list').hidden ? 'bookmarks' : 'toc';
    })()`),

    itemCount: (tab) => exec(`document.querySelectorAll('${LISTS[tab]}').length`),

    async clickItem(tab, index) {
      act(`click entry ${index + 1} in "${tab}"`);
      await exec(`document.querySelectorAll('${LISTS[tab]}')[${index}].click()`);
      await wait(700);
    },
  };
  return panel;
};
