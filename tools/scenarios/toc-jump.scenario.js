// A contents jump followed at once by PageDown (no pause at all): the position must not slide back
// into the previous chapter because chapters not laid out yet have estimated heights (content-visibility)

module.exports = async ({ open, exec, wait, check }) => {
  await exec(`app.updateSettings({ mode: 'scroll' })`);
  for (const role of ['fb2', 'epub']) {
    await open(role);
    await exec(`(() => { document.getElementById('toc-panel').hidden = true; document.getElementById('btn-toc').click(); app.showSidePanel('toc'); })()`);
    await wait(300);
    const items = await exec(`document.querySelectorAll('.toc-item').length`);
    // Entries spread over the book, in a jumpy order
    const picks = [0.2, 0.45, 0.9, 0.1, 0.7].map((f) => Math.floor(f * (items - 1)));
    for (const index of picks) {
      // Click and PageDown in one synchronous block: faster than any person
      const target = await exec(`(() => {
        document.querySelectorAll('.toc-item')[${index}].click();
        const target = app.activeTab.viewer.getLocation();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        return target;
      })()`);
      await wait(1200);
      const after = await exec(`app.activeTab.viewer.getLocation()`);
      // The same chapter (or the next one if the chapter is shorter than a screen), never an earlier one
      const ok = after.c > target.c || (after.c === target.c && after.b >= target.b);
      check(`${role}: contents entry ${index + 1} + PageDown stays in its chapter`, ok, `target c${target.c}/b${target.b} → c${after.c}/b${after.b}`);
    }
  }
};
