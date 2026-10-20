// Continues tabs-themes after a restart: the tabs, the active tab and the theme come back

module.exports = async ({ exec, waitFor, check, has, shot }) => {
  const expected = ['fb2', 'epub', 'pdf', ...(has('djvu') ? ['djvu'] : [])];
  await waitFor(`app.tabs.length === ${expected.length} && app.tabs.every((t) => t.viewer)`, 60000);
  const formats = await exec(`app.tabs.map((t) => t.format).join()`);
  check('all tabs are restored in order', formats === expected.join(), formats);
  check('the active tab is restored', await exec(`app.activeTab === app.tabs[0]`));
  check('the theme is restored', await exec(`app.store.settings.theme === 'dark' && document.documentElement.dataset.theme === 'dark'`));
  await shot('tabs-04-restored');
};

module.exports.continues = 'tabs-themes';
