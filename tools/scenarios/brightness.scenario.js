// Brightness: the slider and Ctrl+Shift+↑/↓ dim only the book area, limits 30–100%,
// the value is saved, "Reset settings" restores 100%, hotkeys don't fire inside text fields
const path = require('node:path');

module.exports = async ({ root, exec, waitFor, wait, shot, log }) => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(!!ok);
    log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };
  const panel = `document.querySelector('.settings-popover')`;
  const brightness = () => exec(`app.store.settings.brightness`);
  const filter = () => exec(`document.getElementById('panes').style.filter`);
  const key = (k) => exec(`(document.activeElement || window).dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', ctrlKey: true, shiftKey: true, bubbles: true }))`);

  check('за замовчуванням 100% і без фільтра', (await brightness()) === 1 && (await filter()) === '');

  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Diuna.fb2'))})`);
  await waitFor(`app.activeTab?.viewer`, 30000);

  // 1) Slider in the first section of the settings panel
  await exec(`document.getElementById('btn-settings').click()`);
  check('повзунок у першому розділі налаштувань', await exec(`!!${panel}.querySelector('.settings-section:first-child input[data-key="brightness"]')`));
  await exec(`(() => { const r = ${panel}.querySelector('input[data-key="brightness"]'); r.value = 0.5; r.dispatchEvent(new Event('input')); })()`);
  await wait(300);
  check('повзунок змінює яскравість', (await brightness()) === 0.5 && (await filter()) === 'brightness(0.5)', await filter());
  check('підпис значення', await exec(`${panel}.querySelector('input[data-key="brightness"]').closest('.setting').querySelector('.slider-value').textContent === '50%'`));
  // Nothing but the book area is dimmed
  const dimmedOutside = await exec(`['tabbar', 'toolbar', 'toc-panel', 'library', 'welcome', 'toast'].filter((id) => {
    for (let el = document.getElementById(id); el; el = el.parentElement) if (getComputedStyle(el).filter !== 'none') return true;
    return false;
  })`);
  check('панелі й вкладки не затемнюються', dimmedOutside.length === 0, dimmedOutside.join(', '));
  check('панель налаштувань не затемнюється', await exec(`(() => { for (let el = ${panel}; el; el = el.parentElement) if (getComputedStyle(el).filter !== 'none') return false; return true; })()`));
  await exec(`document.getElementById('btn-settings').click()`);
  await shot('brightness-01-fb2-50');

  // 2) Hotkeys and limits
  await exec(`document.activeElement?.blur?.()`);
  await key('ArrowUp');
  check('Ctrl+Shift+↑ — світліше на 10%', (await brightness()) === 0.6, String(await brightness()));
  check('сповіщення', await exec(`document.getElementById('toast').textContent === 'Яскравість: 60%'`), await exec(`document.getElementById('toast').textContent`));
  for (let i = 0; i < 6; i++) await key('ArrowUp');
  check('не більше 100%, фільтр знімається', (await brightness()) === 1 && (await filter()) === '');
  for (let i = 0; i < 12; i++) await key('ArrowDown');
  check('не менше 30%', (await brightness()) === 0.3, String(await brightness()));

  // 3) In a text field the keys belong to the field
  await exec(`app.openSearch()`);
  await key('ArrowUp');
  check('у полі пошуку клавіші не змінюють яскравість', (await brightness()) === 0.3);
  await exec(`app.closeSearch()`);

  // 4) PDF in the dark theme: dimming works together with page inversion
  await exec(`app.setTheme('dark')`);
  await exec(`app.updateSettings({ brightness: 0.7 })`);
  await exec(`app.openBook(${JSON.stringify(path.join(root, 'samples', 'Allan_and_Barbara_Pease_-_Body_Language_The_Definitive_Book.pdf'))})`);
  await waitFor(`app.activeTab?.format === 'pdf' && app.activeTab.paneEl.querySelector('canvas')`, 30000);
  await exec(`app.activeTab.viewer.goTo({ page: 20, f: 0 })`);
  await wait(1500);
  check('PDF: затемнення діє', (await filter()) === 'brightness(0.7)');
  await shot('brightness-02-pdf-dark-70');

  // 5) Saved with the other settings
  await wait(800);
  check('значення зберігається', await exec(`window.api.loadState().then((s) => s.settings.brightness === 0.7)`));

  // 6) Both languages
  await exec(`app.updateSettings({ language: 'en' })`);
  await waitFor(`document.documentElement.lang === 'en'`, 5000);
  await exec(`document.getElementById('btn-settings').click()`);
  check('англійський підпис', await exec(`${panel}.querySelector('input[data-key="brightness"]').getAttribute('aria-label') === 'Brightness'`));
  await exec(`document.getElementById('btn-settings').click()`);
  await exec(`app.updateSettings({ language: 'auto' })`);

  // 7) "Reset settings" brings back 100%
  await exec(`app.resetSettings()`);
  await wait(200);
  check('«Скинути налаштування» повертає 100%', (await brightness()) === 1 && (await filter()) === '');

  log(`RESULT ${results.filter(Boolean).length}/${results.length} passed`);
};
