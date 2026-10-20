// Runs after bookmarks.scenario.js with AUTOTEST_KEEP_STATE=1: bookmarks must be preserved
module.exports = async ({ exec, waitFor, wait, log }) => {
  await waitFor(`app.tabs.length === 2 && app.tabs.every(t => t.viewer)`, 30000);
  await wait(300);
  const counts = await exec(`JSON.stringify(app.tabs.map(t => [t.format, (t.record.bookmarks ?? []).length]))`);
  const ok = counts === '[["fb2",1],["pdf",1]]';
  log(`${ok ? 'OK  ' : 'FAIL'} закладки збереглися після перезапуску — ${counts}`);
};
