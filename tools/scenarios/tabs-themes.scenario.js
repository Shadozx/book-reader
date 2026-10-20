// Tabs and themes: a book of every format opens in its own tab, themes switch for the whole window.
// tabs-themes-restore continues this run and checks that everything comes back after a restart.

module.exports = async ({ open, exec, check, shot }) => {
  await shot('tabs-01-welcome');
  for (const role of ['fb2', 'epub', 'pdf', 'djvuLarge']) await open(role);

  const formats = await exec(`app.tabs.map((t) => t.format).join()`);
  check('every book opens in its own tab', formats === 'fb2,epub,pdf,djvu', formats);
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
};
