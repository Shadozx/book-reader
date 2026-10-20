module.exports = async ({ exec, waitFor, wait, shot, log }) => {
  await waitFor(`app.activeTab?.viewer`, 30000);
  await wait(500);
  log('restored', await exec(`JSON.stringify({ mode: app.store.settings.mode, loc: app.activeTab.viewer.getLocation(), progress: app.activeTab.viewer.progress().text, saved: app.activeTab.record.location })`));
  await shot('s3-08-restored');
};
