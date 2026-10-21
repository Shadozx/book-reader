'use strict';
// Autotest: electron tools/autotest.js <scenario.js> <output folder> [--step=N]   (npm test runs them all)
// A scenario is a module exporting async (ctx) => { ... }, or an array of such steps: between steps
// the app is closed and started again on the same data, like a user restarting it. This process runs
// one step (the first by default, --step=N for the others; npm test runs them all in order).
// ctx holds the basic helpers below plus the shared ones from tools/test-kit.js.
// The window is closed the way a user closes it; the exit code is 1 if a check failed.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createKit, LANG } = require('./test-kit');

const [scenarioArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('-') && a !== '.');
const scenarioPath = path.resolve(scenarioArg);
const outDir = path.resolve(outArg);
const step = Number(process.argv.find((a) => a.startsWith('--step='))?.slice(7) ?? 0);
fs.mkdirSync(outDir, { recursive: true });

// The first step starts with no saved data; later steps continue with what the previous one saved
if (step === 0) fs.rmSync(path.join(outDir, 'userdata'), { recursive: true, force: true });
app.setPath('userData', path.join(outDir, 'userdata'));
process.env.AUTOTEST_AUTOCONFIRM ??= '1';
process.env.CHYTALKA_BACKUP_DIR ??= path.join(outDir, 'backups');
// The interface language of the run doesn't depend on the machine: the "system language" is the test language
process.env.CHYTALKA_SYSTEM_LANG ??= LANG;
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
  const kit = createKit(ctx);
  Object.assign(ctx, kit);

  const scenario = require(scenarioPath);
  const steps = Array.isArray(scenario) ? scenario : [scenario];
  let crashed = false;
  try {
    if (!steps[step]) throw new Error(`The scenario has no step ${step}`);
    await wait(300);
    await steps[step](ctx);
  } catch (err) {
    log('SCENARIO ERROR', err);
    crashed = true;
  }
  const passed = kit.results.filter((r) => r.ok).length;
  const skipped = kit.skipped.length ? `, ${kit.skipped.length} skipped` : '';
  if (kit.results.length || kit.skipped.length) log(`RESULT ${passed}/${kit.results.length} passed${skipped}`);

  // Close the window like a user does: the app saves its state and quits on its own.
  // The exit code is set once it's quitting, after a moment for the last writes to finish.
  const code = crashed || passed < kit.results.length ? 1 : 0;
  app.once('will-quit', (e) => {
    e.preventDefault();
    setTimeout(() => app.exit(code), 600);
  });
  await wait(300);
  win.close();
});
