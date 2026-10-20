// Runs after stage1 with AUTOTEST_KEEP_STATE=1: checks that tabs are restored
module.exports = async ({ exec, waitFor, shot }) => {
  await waitFor(`app.tabs.length > 0 && app.tabs.every(t => t.format)`);
  console.log('restored:', await exec(`JSON.stringify({n: app.tabs.length, active: app.activeTab?.path, theme: app.store.settings.theme})`));
  await shot('05-restored');
};
