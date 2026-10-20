// Search (Ctrl+F) in every format: the match count, the current match shown on screen,
// moving between matches, "not found", closing with Esc

module.exports = async ({ open, exec, waitFor, wait, check, skip, has, press, facts, t, shot }) => {
  const CASES = [
    { role: 'fb2', query: facts['book.fb2'].searchWord, count: facts['book.fb2'].searchCount, mode: 'scroll' },
    { role: 'fb2', query: facts['book.fb2'].searchWord, count: facts['book.fb2'].searchCount, mode: 'paged' },
    { role: 'epub', query: 'капітан', mode: 'scroll' },
    { role: 'pdf', query: facts['book.pdf'].searchWord, count: facts['book.pdf'].searchCount, mode: 'scroll' },
    { role: 'djvu', query: 'сократ', mode: 'scroll' },
    { role: 'djvuLarge', query: 'наполеон', mode: 'paged' },
  ];
  const input = `document.getElementById('search-input')`;
  const counter = () => exec(`document.getElementById('search-count').textContent`);
  // The current match is highlighted and lies inside the book view
  const currentVisible = `(() => {
    const h = CSS.highlights.get('search-current');
    if (!h || !h.size) return false;
    const r = [...h][0].getBoundingClientRect();
    const box = app.activeTab.paneEl.getBoundingClientRect();
    return r.height > 0 && r.top >= box.top && r.bottom <= box.bottom && r.left >= box.left && r.right <= box.right;
  })()`;
  const search = async (query) => {
    await exec(`(() => { ${input}.value = ${JSON.stringify(query)}; ${input}.dispatchEvent(new Event('input')); })()`);
    return waitFor(`/^\\d+ \\/ \\d+\\+?$/.test(document.getElementById('search-count').textContent) || document.getElementById('search-count').textContent === ${JSON.stringify(t('search.notFound'))}`, 60000);
  };

  for (const c of CASES) {
    const name = `${c.role} (${c.mode})`;
    if (!has(c.role)) {
      skip(`${name}: no optional sample book`);
      continue;
    }
    await exec(`app.updateSettings({ mode: '${c.mode}' })`);
    await open(c.role);
    await wait(500);
    await press('f', { ctrl: true });
    check(`${name}: Ctrl+F opens the search field`, await exec(`!document.getElementById('search-bar').hidden && document.activeElement === ${input}`));

    const started = Date.now();
    await search(c.query);
    const first = await counter();
    const [, index, total] = first.match(/^(\d+) \/ (\d+)/) ?? [];
    check(`${name}: "${c.query}" is found`, c.count ? Number(total) === c.count : Number(total) > 0, `${first} in ${Date.now() - started} ms`);
    check(`${name}: the current match is on screen`, await waitFor(currentVisible, 10000));

    await exec(`${input}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await waitFor(currentVisible, 10000);
    const second = await counter();
    check(`${name}: Enter goes to the next match`, Number(second.split(' ')[0]) === Number(index) % Number(total) + 1, `${first} → ${second}`);
    check(`${name}: the next match is on screen`, await exec(currentVisible));
    await shot(`search-${c.role}-${c.mode}`);

    await exec(`${input}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    check(`${name}: Esc closes the search and clears highlights`, await exec(`document.getElementById('search-bar').hidden && !CSS.highlights.has('search-hit')`));
  }

  // A word that isn't in the book
  await open('fb2');
  await press('f', { ctrl: true });
  await search('qwzxjv');
  check('a missing word shows "not found"', (await counter()) === t('search.notFound'), await counter());
};
