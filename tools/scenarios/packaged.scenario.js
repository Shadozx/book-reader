// The built app (npm run dist first): every format opens from app.asar with its text or pages.
// npm test runs it with AUTOTEST_APP=dist/win-unpacked/resources/app.asar and skips it without a build.

module.exports = async ({ open, exec, waitFor, check, skip, has, log, shot }) => {
  log('app root:', await exec(`location.href`));
  for (const role of ['fb2', 'epub', 'pdf', 'djvu']) {
    if (!has(role)) {
      skip(`${role}: no optional sample book`);
      continue;
    }
    await open(role);
    // A PDF cover may have no text, so the text layer is checked in the middle of the book
    await exec(`app.activeTab.viewer.kind === 'fixed' && app.activeTab.viewer.goTo({ page: Math.floor(app.activeTab.viewer.pageCount / 2), f: 0 })`);
    const ok = await waitFor(`(() => {
      const v = app.activeTab.viewer, el = app.activeTab.paneEl;
      return v.kind === 'flow'
        ? el.querySelectorAll('.book-content p').length > 50
        : el.querySelectorAll('.fixed-page canvas').length > 0 && !!el.querySelector('.textLayer span, .djvuTextLayer span');
    })()`, 30000);
    check(`${role} opens from the built app`, ok);
  }
  await shot('packaged');
};

module.exports.packaged = true;
