// Continues reading-modes after a restart: the mode and the reading position come back

module.exports = async ({ exec, waitFor, wait, check, shot }) => {
  await waitFor(`app.activeTab?.viewer`, 60000);
  await wait(500);
  const state = await exec(`({ mode: app.store.settings.mode, now: app.activeTab.viewer.getLocation(), saved: app.activeTab.record.location })`);
  check('the paged mode is restored', state.mode === 'paged');
  check('the book opens where reading stopped', state.now.c === state.saved.c && Math.abs(state.now.b - state.saved.b) <= 2, `${JSON.stringify(state.saved)} → ${JSON.stringify(state.now)}`);
  await shot('modes-05-restored');
};

module.exports.continues = 'reading-modes';
