// Text, images and the toolbar fit windows of different sizes, in both modes

const BOOKS = ['fb2Images', 'epub', 'pdf', 'djvuLarge'];
const SIZES = [[1280, 860], [800, 600], [520, 400]];

// Runs in the window and returns the list of problems found
const FIND_PROBLEMS = `(() => {
  const problems = [];
  const pane = app.activeTab.paneEl;
  const bar = document.getElementById('toolbar');
  if (bar.scrollWidth > bar.clientWidth + 1) problems.push('toolbar overflows: ' + bar.scrollWidth + ' > ' + bar.clientWidth);
  // Every visible toolbar control fits whole (not squeezed or cut off)
  const barRight = bar.getBoundingClientRect().right;
  for (const el of bar.querySelectorAll('button, select, #progress')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (r.right > barRight + 1) problems.push('toolbar control outside the window: ' + (el.id || el.title || el.tagName));
    if (el.id === 'progress' && el.scrollWidth > el.clientWidth + 1) problems.push('page counter is cut off');
    if (el.tagName === 'BUTTON' && r.width < 24) problems.push('button squeezed: ' + (el.id || el.title));
  }
  const tabs = document.getElementById('tabbar');
  if (tabs.scrollWidth > tabs.clientWidth + 1) problems.push('tab bar wider than the window');
  const v = app.activeTab.viewer;
  if (v.kind === 'flow') {
    if (!pane.querySelector('.flow').classList.contains('paged')) {
      const sc = pane.querySelector('.flow-scroller');
      if (sc.scrollWidth > sc.clientWidth + 1) problems.push('text scrolls sideways: ' + sc.scrollWidth + ' > ' + sc.clientWidth);
      const content = pane.querySelector('.flow-scroller .book-content');
      const cs = getComputedStyle(content);
      const inner = content.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      for (const img of content.querySelectorAll('img')) {
        const r = img.getBoundingClientRect();
        if (r.width > inner + 1) problems.push('image wider than the column: ' + Math.round(r.width) + ' > ' + Math.round(inner));
      }
      for (const el of content.querySelectorAll('table, pre')) {
        if (el.getBoundingClientRect().width > inner + 1) problems.push(el.tagName + ' wider than the column');
      }
      return problems;
    }
    const clip = pane.querySelector('.page-clip').getBoundingClientRect();
    const columns = pane.querySelector('.page-strip').style.columnCount || 1;
    for (const img of pane.querySelectorAll('.page-strip img')) {
      const r = img.getBoundingClientRect();
      if (!r.width) continue;
      if (r.height > clip.height + 1) problems.push('image taller than the page: ' + Math.round(r.height) + ' > ' + Math.round(clip.height));
      if (r.width > clip.width / columns + 1) problems.push('image wider than the column');
    }
    if (clip.left < 0 || clip.right > pane.getBoundingClientRect().right + 1) problems.push('the page goes outside the window');
    return problems;
  }
  // PDF / DjVu
  const sc = pane.querySelector('.fixed-scroller');
  const zoom = v.zoomValue;
  if (['auto', 'width', 'page'].includes(zoom) && sc.scrollWidth > sc.clientWidth + 1) problems.push('page wider than the window at zoom ' + zoom);
  const visible = [...pane.querySelectorAll('.fixed-page:not(.off)')].filter((p) => { const r = p.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  if (zoom === 'page') for (const p of visible) if (p.getBoundingClientRect().height > sc.clientHeight + 1) problems.push('page taller than the window at "fit page"');
  return problems;
})()`;

module.exports = async ({ open, exec, wait, check, skip, has, resize, shot }) => {
  for (const role of BOOKS) {
    if (!has(role)) {
      skip(`${role}: no optional sample book`);
      continue;
    }
    resize(1280, 860);
    await exec(`app.updateSettings({ mode: 'scroll' })`);
    await open(role);
    // Text books: go to a chapter with images, so paged mode has something to check
    await exec(`(() => {
      const v = app.activeTab.viewer;
      if (v.kind !== 'flow') return v.goTo({ page: Math.floor(v.pageCount / 2), f: 0 });
      const img = [...app.activeTab.paneEl.querySelectorAll('.book-content .chunk:not(.cover-chunk) img')][3];
      const chunk = img?.closest('[data-id]');
      if (chunk) v.goTo({ id: chunk.dataset.id });
    })()`);
    for (const [w, h] of SIZES) {
      resize(w, h);
      for (const mode of ['scroll', 'paged']) {
        await exec(`app.updateSettings({ mode: '${mode}' })`);
        await wait(700);
        const problems = await exec(FIND_PROBLEMS);
        check(`${role} ${w}×${h} ${mode}: everything fits`, problems.length === 0, problems.join('; '));
        if (w === 520) await shot(`resize-${role}-${mode}-${w}`);
      }
    }
  }
  resize(1280, 860);
};
