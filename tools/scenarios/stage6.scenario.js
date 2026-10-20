// Settings panel: every control really changes the book, the reading position is preserved
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, shot, wait, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const panel = `document.querySelector('.settings-popover')`;
  const para = `app.activeTab.paneEl.querySelector('.flow-scroller .book-content .chunk:not(.cover-chunk) p')`;
  // Set a slider value the way a user does (input event)
  const setSlider = (key, value) => exec(`(() => { const r = ${panel}.querySelector('input[data-key="${key}"]'); r.value = ${value}; r.dispatchEvent(new Event('input')); })()`);
  const clickSeg = (label) => exec(`[...${panel}.querySelectorAll('.seg button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  const loc = () => exec(`JSON.stringify(app.activeTab.viewer.getLocation())`);
  const key = (code, k) => exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', code: '${code}', ctrlKey: true, bubbles: true }))`);

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await exec(`document.getElementById('btn-toc').click()`);
  await exec(`document.querySelectorAll('.toc-item')[6].click()`);
  await exec(`document.getElementById('btn-toc').click()`);
  await wait(600);
  const startLoc = await loc();

  await exec(`document.getElementById('btn-settings').click()`);
  check('панель відкривається кнопкою T', await exec(`!${panel}.hidden`));
  await shot('s6-01-panel-light');

  await setSlider('fontSize', 26);
  await wait(400);
  check('розмір шрифту (повзунок)', await exec(`getComputedStyle(${para}).fontSize === '26px'`), await exec(`getComputedStyle(${para}).fontSize`));
  const afterFont = await loc();
  check('місце читання після зміни шрифту', JSON.parse(afterFont).b === JSON.parse(startLoc).b, `${startLoc} → ${afterFont}`);

  await exec(`(() => { const s = ${panel}.querySelector('.font-select'); s.value = [...s.options].find(o => o.textContent === 'Verdana').value; s.dispatchEvent(new Event('change')); })()`);
  await wait(300);
  check('шрифт Verdana', await exec(`getComputedStyle(${para}).fontFamily.includes('Verdana')`));

  await setSlider('lineHeight', 2);
  await setSlider('margin', 100);
  await setSlider('indent', 3);
  await setSlider('paraSpacing', 1);
  await wait(400);
  check('міжрядковий інтервал 2.0', await exec(`getComputedStyle(${para}).lineHeight === (26 * 2) + 'px'`), await exec(`getComputedStyle(${para}).lineHeight`));
  check('поля 100 px', await exec(`getComputedStyle(${para}.closest('.book-content')).paddingLeft === '100px'`));
  check('абзацний відступ 3 em', await exec(`getComputedStyle(${para}).textIndent === (26 * 3) + 'px'`), await exec(`getComputedStyle(${para}).textIndent`));
  check('відстань між абзацами 1 em', await exec(`getComputedStyle(${para}).marginBottom === '26px'`), await exec(`getComputedStyle(${para}).marginBottom`));

  await setSlider('maxWidth', 1600);
  await wait(300);
  check('ширина колонки «без обмеження»', await exec(`app.store.settings.maxWidth === 0 && ${panel}.querySelector('input[data-key="maxWidth"]').closest('.setting').querySelector('.slider-value').textContent === 'без обмеження'`));

  await clickSeg('По лівому краю');
  await wait(200);
  check('вирівнювання по лівому краю', await exec(`getComputedStyle(${para}).textAlign === 'left'`));

  await clickSeg('Сепія');
  check('тема сепія', await exec(`document.documentElement.dataset.theme === 'sepia'`));
  await shot('s6-02-panel-sepia-changed');

  await clickSeg('Сторінки');
  await wait(400);
  check('режим «Сторінки» з панелі', await exec(`app.activeTab.paneEl.querySelector('.flow').classList.contains('paged')`));
  await clickSeg('Прокрутка');
  await wait(300);

  // Hotkeys
  await exec(`document.getElementById('btn-settings').click()`);
  check('повторний клік T закриває панель', await exec(`${panel}.hidden`));
  await key('Equal', '=');
  check('Ctrl+= збільшує шрифт', await exec(`app.store.settings.fontSize === 27`));
  check('сповіщення про розмір', await exec(`document.getElementById('toast').classList.contains('show') && document.getElementById('toast').textContent`), await exec(`document.getElementById('toast').textContent`));
  await key('Minus', '-');
  await key('Minus', '-');
  check('Ctrl+- зменшує шрифт', await exec(`app.store.settings.fontSize === 25`));
  await key('Digit0', '0');
  check('Ctrl+0 — стандартний розмір', await exec(`app.store.settings.fontSize === app.DEFAULT_SETTINGS.fontSize`));

  // Reset
  await exec(`document.getElementById('btn-settings').click()`);
  await exec(`${panel}.querySelector('.reset-btn').click()`);
  await wait(300);
  check('скидання шрифту й відступів', await exec(`['fontFamily','fontSize','lineHeight','margin','maxWidth','indent','paraSpacing','align'].every(k => app.store.settings[k] === app.DEFAULT_SETTINGS[k])`));
  check('скидання не чіпає тему', await exec(`app.store.settings.theme === 'sepia'`));
  await exec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  check('Esc закриває панель', await exec(`${panel}.hidden`));
  const endLoc = await loc();
  check('місце читання після всіх змін', JSON.parse(endLoc).b === JSON.parse(startLoc).b, `${startLoc} → ${endLoc}`);

  // PDF: the "Text" section is dimmed, Ctrl+= changes the zoom
  await exec(`app.setTheme('dark')`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf'))})`);
  await waitFor(`app.activeTab.viewer`, 30000);
  await wait(500);
  await exec(`document.getElementById('btn-settings').click()`);
  check('для PDF розділ «Текст» приглушений', await exec(`${panel}.querySelectorAll('.settings-section')[1].classList.contains('dimmed')`));
  await shot('s6-03-panel-pdf-dark');
  await exec(`document.getElementById('btn-settings').click()`);
  await key('Equal', '=');
  check('Ctrl+= у PDF змінює масштаб', await exec(`typeof app.activeTab.viewer.zoomValue === 'number' && document.getElementById('toast').textContent.startsWith('Масштаб')`), await exec(`document.getElementById('toast').textContent`));

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
