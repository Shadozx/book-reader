const path = require('node:path');

module.exports = async ({ root, exec, waitFor, shot, wait }) => {
  const s = (name) => JSON.stringify(path.join(root, 'samples', name));
  await shot('01-welcome');
  await exec(`app.openBook(${s('Diuna.fb2')})`);
  await exec(`app.openBook(${s('Holidey_Muzhestvo-Pochemu-smelym-sudba-pomogaet.677332.epub')})`);
  await exec(`app.openBook(${s('Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf')})`);
  await exec(`app.openBook(${s('las-cases_eo01-1.djvu')})`);
  await waitFor(`app.tabs.every(t => t.format)`);
  await shot('02-tabs-light');
  await exec(`app.setTheme('dark')`);
  await exec(`app.activateTab(app.tabs[0])`);
  await shot('03-tabs-dark');
  await exec(`app.setTheme('sepia')`);
  await shot('04-tabs-sepia');
  console.log(await exec(`JSON.stringify(app.tabs.map(t => [t.format, t.record.title]))`));
};
