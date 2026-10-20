// A quick DjVu check on one book: opening speed, table of contents, text layer, copying text.
// Needs the optional DjVu sample (DjVu can't be generated); DJVU_ROLE picks another role.

module.exports = async ({ open, exec, waitFor, check, skip, has, pagesReady, shot }) => {
  const role = process.env.DJVU_ROLE || 'djvu';
  if (!has(role)) return skip(`${role}: no optional sample book`);
  const pane = `app.activeTab.paneEl`;

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  const started = Date.now();
  await open(role);
  const opened = Date.now() - started;
  check('the first pages are drawn', await pagesReady(), `opened in ${opened} ms, drawn in ${Date.now() - started} ms`);
  check('table of contents', await waitFor(`app.activeTab.viewer.toc.length > 0`, 20000), `${await exec(`app.activeTab.viewer.toc.length`)} entries`);
  check('the contents button is enabled', await exec(`!document.getElementById('btn-toc').disabled`));

  const page = Math.floor((await exec(`app.activeTab.viewer.pageCount`)) / 2);
  const jumped = Date.now();
  await exec(`app.activeTab.viewer.goTo({ page: ${page}, f: 0 })`);
  await pagesReady();
  const spans = `${pane}.querySelectorAll('.fixed-page[data-num="${page + 1}"] .djvuTextLayer span')`;
  check(`page ${page + 1} is drawn with its text layer`, await waitFor(`${spans}.length > 5`, 10000), `${Date.now() - jumped} ms, ${await exec(`${spans}.length`)} words`);
  await shot('djvu-quick-middle');

  // Selecting the first words copies readable text
  const copied = await exec(`(() => {
    const spans = ${spans};
    const range = document.createRange();
    range.setStartBefore(spans[0]);
    range.setEndAfter(spans[Math.min(8, spans.length - 1)]);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  })()`);
  check('selected text can be copied', /\p{L}{3,}/u.test(copied), JSON.stringify(copied.slice(0, 80)));

  await exec(`app.activeTab.viewer.goTo({ page: 0, f: 0 })`);
  check('the cover is drawn', await pagesReady());
  await shot('djvu-quick-cover');
};
