// Reading settings panel (the "T" button): every control really changes the book, the reading
// position survives all changes, hotkeys for the font size, resetting text settings

const TEXT_KEYS = ['fontFamily', 'fontSize', 'lineHeight', 'margin', 'maxWidth', 'indent', 'paraSpacing', 'align'];

module.exports = async ({ open, exec, wait, check, press, tocItem, location, t, shot }) => {
  const panel = `document.querySelector('.reading-popover')`;
  // A plain body paragraph: epigraphs, quotes and headings have their own sizes and indents
  const paragraph = `[...app.activeTab.paneEl.querySelectorAll('.flow-scroller .book-content .chunk:not(.cover-chunk) p')].find((p) => !p.closest('blockquote, h1, h2, h3, h4, h5, h6, .annotation'))`;
  const style = (prop) => exec(`getComputedStyle(${paragraph}).${prop}`);
  // Change a slider the way a user does (an input event)
  const setSlider = (key, value) => exec(`(() => { const r = ${panel}.querySelector('input[data-key="${key}"]'); r.value = ${value}; r.dispatchEvent(new Event('input')); })()`);
  const choose = (value) => exec(`${panel}.querySelector('.seg button[data-value="${value}"]').click()`);
  const toast = () => exec(`document.getElementById('toast').textContent`);
  const samePlace = (a, b) => a.c === b.c && a.b === b.b;

  await exec(`app.updateSettings({ mode: 'scroll' })`);
  await open('fb2');
  await tocItem(6);
  await wait(600);
  const start = await location();

  await exec(`document.getElementById('btn-settings').click()`);
  check('the "T" button opens the panel', await exec(`!${panel}.hidden`));
  await shot('settings-01-panel');

  await setSlider('fontSize', 26);
  await wait(400);
  check('font size slider', (await style('fontSize')) === '26px', await style('fontSize'));
  check('the place survives a font size change', samePlace(await location(), start));

  await exec(`(() => { const s = ${panel}.querySelector('.font-select'); s.value = [...s.options].find((o) => o.textContent === 'Verdana').value; s.dispatchEvent(new Event('change')); })()`);
  await wait(300);
  check('font family', (await style('fontFamily')).includes('Verdana'));

  await setSlider('lineHeight', 2);
  await setSlider('margin', 100);
  await setSlider('indent', 3);
  await setSlider('paraSpacing', 1);
  await wait(400);
  check('line spacing', (await style('lineHeight')) === `${26 * 2}px`, await style('lineHeight'));
  check('margins', await exec(`getComputedStyle(${paragraph}.closest('.book-content')).paddingLeft === '100px'`));
  check('paragraph indent', (await style('textIndent')) === `${26 * 3}px`, await style('textIndent'));
  check('paragraph spacing', (await style('marginBottom')) === '26px', await style('marginBottom'));

  await setSlider('maxWidth', 1600);
  await wait(300);
  check('column width "unlimited" at the far right', await exec(`app.store.settings.maxWidth === 0 && ${panel}.querySelector('input[data-key="maxWidth"]').closest('.setting').querySelector('.slider-value').textContent === ${JSON.stringify(t('settings.unlimited'))}`));

  await choose('left');
  await wait(200);
  check('left alignment', (await style('textAlign')) === 'left');

  await choose('sepia');
  check('sepia theme', await exec(`document.documentElement.dataset.theme === 'sepia'`));
  await shot('settings-02-changed');

  await choose('paged');
  await wait(400);
  check('paged mode from the panel', await exec(`app.activeTab.paneEl.querySelector('.flow').classList.contains('paged')`));
  await choose('scroll');
  await wait(300);

  // Hotkeys
  await exec(`document.getElementById('btn-settings').click()`);
  check('a second click on "T" closes the panel', await exec(`${panel}.hidden`));
  const size = await exec(`app.store.settings.fontSize`);
  await press('=', { ctrl: true });
  check('Ctrl+= makes the font bigger', (await exec(`app.store.settings.fontSize`)) === size + 1);
  check('a notification shows the new size', (await toast()) === t('toast.font', { size: size + 1 }), await toast());
  await press('-', { ctrl: true });
  await press('-', { ctrl: true });
  check('Ctrl+- makes the font smaller', (await exec(`app.store.settings.fontSize`)) === size - 1);
  await press('0', { ctrl: true });
  check('Ctrl+0 restores the default size', await exec(`app.store.settings.fontSize === app.DEFAULT_SETTINGS.fontSize`));

  // Reset
  await exec(`document.getElementById('btn-settings').click()`);
  await exec(`${panel}.querySelector('.reset-btn').click()`);
  await wait(300);
  check('"Reset" restores font and spacing', await exec(`${JSON.stringify(TEXT_KEYS)}.every((k) => app.store.settings[k] === app.DEFAULT_SETTINGS[k])`));
  check('"Reset" keeps the theme', await exec(`app.store.settings.theme === 'sepia'`));
  await press('Escape');
  check('Esc closes the panel', await exec(`${panel}.hidden`));
  check('the place survives all the changes', samePlace(await location(), start), `${JSON.stringify(start)} → ${JSON.stringify(await location())}`);

  // PDF: the text section doesn't apply, Ctrl+= zooms instead
  await exec(`app.setTheme('dark')`);
  await open('pdf');
  await wait(500);
  await exec(`document.getElementById('btn-settings').click()`);
  check('for a PDF the text section is dimmed', await exec(`${panel}.querySelectorAll('.settings-section')[1].classList.contains('dimmed')`));
  await shot('settings-03-pdf');
  await exec(`document.getElementById('btn-settings').click()`);
  await press('=', { ctrl: true });
  const zoomText = t('toast.zoom', { percent: '\u0000' }).split('\u0000')[0];
  check('Ctrl+= zooms a PDF', await exec(`typeof app.activeTab.viewer.zoomValue === 'number'`) && (await toast()).startsWith(zoomText), await toast());
};
