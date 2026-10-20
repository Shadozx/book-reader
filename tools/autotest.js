'use strict';
// Autotest: electron tools/autotest.js <scenario.js> <output folder>
// A scenario is a module exporting async (ctx) => { ... }

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const [scenarioArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('-') && a !== '.');
const scenarioPath = path.resolve(scenarioArg);
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });

if (!process.env.AUTOTEST_KEEP_STATE) {
  fs.rmSync(path.join(outDir, 'userdata'), { recursive: true, force: true });
}
app.setPath('userData', path.join(outDir, 'userdata'));
process.env.AUTOTEST_AUTOCONFIRM ??= '1';
process.env.CHYTALKA_BACKUP_DIR ??= path.join(outDir, 'backups');
// Tests check Ukrainian texts, so "system language" is Ukrainian regardless of the machine
process.env.CHYTALKA_SYSTEM_LANG ??= 'uk';
// AUTOTEST_APP=<path to app.asar>: test the already built (packaged) app (a relative path is taken from the current folder).
// If the app can't be loaded, report it in the log and exit instead of Electron's error dialog, which would hang the run.
try {
  require(process.env.AUTOTEST_APP ? path.resolve(process.env.AUTOTEST_APP, 'src', 'main', 'main.js') : '../src/main/main.js');
} catch (err) {
  console.log('[autotest] APP LOAD ERROR', err);
  app.exit(1);
}

const log = (...args) => console.log('[autotest]', ...args);

async function getWindow() {
  for (;;) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) return win;
    await new Promise((r) => setTimeout(r, 50));
  }
}

app.whenReady().then(async () => {
  const win = await getWindow();
  const wc = win.webContents;
  wc.on('console-message', (event) => log(`console.${event.level}:`, event.message));
  wc.on('render-process-gone', (_e, details) => log('RENDERER CRASH', details));
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  wc.setBackgroundThrottling(false);
  win.setContentSize(1280, 860);
  win.show();

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ctx = {
    root: path.resolve(__dirname, '..'),
    wait,
    // A result that can't be passed between processes (DOM, tabs) is replaced with null
    exec: (js) => wc.executeJavaScript(`(async () => { const r = await (${js}); try { return structuredClone(r); } catch { return null; } })()`, true),
    async waitFor(js, timeout = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await wc.executeJavaScript(`!!(${js})`, true)) return true;
        await wait(100);
      }
      log('TIMEOUT waiting for:', js);
      return false;
    },
    async shot(name) {
      // Force a repaint: otherwise a covered window may return a stale frame
      wc.invalidate();
      await wait(250);
      const image = await wc.capturePage();
      const file = path.join(outDir, `${name}.png`);
      fs.writeFileSync(file, image.toPNG());
      log('screenshot', file);
    },
    resize: (w, hgt) => win.setContentSize(w, hgt),
    // A real mouse click (events go through Chromium just like from a physical mouse)
    async click(x, y, button = 'left') {
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
      await wait(60);
    },
    key: (keyCode, modifiers = []) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    },
    log,
  };

  try {
    await wait(300);
    await require(scenarioPath)(ctx);
  } catch (err) {
    log('SCENARIO ERROR', err);
  }
  await wait(600); // let the state saving finish
  app.exit(0);
});
