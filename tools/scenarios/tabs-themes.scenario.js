// Tabs and themes: a book of every format opens in its own tab, themes switch for the whole window;
// after a restart the tabs, the active tab and the theme come back.

// One book of every format (DjVu only if the optional sample is there)
const roles = (has) => ['fb2', 'epub', 'pdf', ...(has('djvu') ? ['djvu'] : [])];

module.exports = [
  async ({ open, exec, check, skip, has, shot }) => {
    await shot('tabs-01-welcome');
    if (!has('djvu')) skip('DjVu tab: no optional DjVu sample');
    for (const role of roles(has)) await open(role);

    const formats = await exec(`app.tabs.map((t) => t.format).join()`);
    check('every book opens in its own tab', formats === roles(has).join(), formats);
    check('the last opened book is the active tab', await exec(`app.activeTab === app.tabs.at(-1) && app.activeTab.tabEl.classList.contains('active')`));
    check('tabs show book titles', await exec(`app.tabs.every((t) => t.record.title && t.titleEl.textContent === t.record.title)`));
    await shot('tabs-02-light');

    // Each theme gives the window its own background
    const backgrounds = [];
    for (const theme of ['light', 'sepia', 'dark']) {
      await exec(`app.setTheme('${theme}')`);
      backgrounds.push(await exec(`document.documentElement.dataset.theme + ' ' + getComputedStyle(document.getElementById('tabbar')).backgroundColor`));
    }
    check('three themes, three different looks', new Set(backgrounds.map((b) => b.split(' ').slice(1).join(' '))).size === 3, backgrounds.join(' | '));

    await exec(`app.activateTab(app.tabs[0])`);
    check('switching tabs shows that tab’s book only', await exec(`app.activeTab.format === 'fb2' && !app.activeTab.paneEl.hidden && app.tabs.slice(1).every((t) => t.paneEl.hidden)`));
    await shot('tabs-03-dark');
  },

  // After a restart
  async ({ exec, waitFor, check, has, shot }) => {
    const expected = roles(has);
    await waitFor(`app.tabs.length === ${expected.length} && app.tabs.every((t) => t.viewer)`, 60000);
    const formats = await exec(`app.tabs.map((t) => t.format).join()`);
    check('after a restart: all tabs are back in order', formats === expected.join(), formats);
    check('after a restart: the active tab is the same', await exec(`app.activeTab === app.tabs[0]`));
    check('after a restart: the theme is the same', await exec(`app.store.settings.theme === 'dark' && document.documentElement.dataset.theme === 'dark'`));
    await shot('tabs-04-restarted');
  },
];
