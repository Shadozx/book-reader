'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { t, setLanguage } = require('./i18n');

const ROOT = path.resolve(__dirname, '..', '..');
const BOOK_EXTENSIONS = ['fb2', 'zip', 'epub', 'pdf', 'djvu', 'djv'];
// From package.json: app.getVersion() gives Electron's version when the app is started by the autotests
const APP_VERSION = require(path.join(ROOT, 'package.json')).version;

// Only these project folders are exposed to the page via the app:// protocol
const SERVED_DIRS = [
  path.join(ROOT, 'src', 'renderer'),
  path.join(ROOT, 'vendor'),
  path.join(ROOT, 'node_modules', 'pdfjs-dist'),
  path.join(ROOT, 'node_modules', 'jszip', 'dist'),
  path.join(ROOT, 'node_modules', 'djvu-rs'),
];

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow = null;
let pendingFiles = [];
let resetting = false;   // state is not written while "Reset all" is in progress

const stateFile = () => path.join(app.getPath('userData'), 'state.json');

function isBookPath(p) {
  return typeof p === 'string' && BOOK_EXTENSIONS.includes(path.extname(p).slice(1).toLowerCase());
}

function filesFromArgv(argv) {
  // The first argument is the exe, followed by "." (the app path when run via npm start)
  return argv.slice(1).filter((a) => !a.startsWith('-') && isBookPath(a)).map((a) => path.resolve(a));
}

function openFilesInWindow(files) {
  if (!files.length) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('open-files', files);
  } else {
    pendingFiles.push(...files);
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, file);
}

// Fit the saved window bounds into the visible screen area
function fitToScreen(bounds) {
  if (!bounds?.width || !bounds?.height) return {};
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  return { x, y, width, height, maximized: bounds.maximized };
}

function createWindow(bounds) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    ...bounds,
    minWidth: 520,
    minHeight: 400,
    backgroundColor: '#1e1f22',
    title: t('app.name'),
    icon: path.join(ROOT, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  if (bounds?.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  // External links from books open in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', async () => {
    if (resetting) return;
    const data = await readJson(stateFile(), {});
    data.window = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() };
    await writeJsonAtomic(stateFile(), data).catch(() => {});
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL('app://bundle/src/renderer/index.html');
}

function registerProtocol() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    const allowed = SERVED_DIRS.some((dir) => filePath.startsWith(dir + path.sep));
    if (!allowed) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerIpc() {
  ipcMain.handle('book:read', async (_e, filePath) => {
    if (!isBookPath(filePath)) throw new Error(t('error.unsupportedFile'));
    const data = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);
    return { data, size: stat.size, mtime: stat.mtimeMs };
  });

  ipcMain.handle('book:exists', async (_e, filePath) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('dialog:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.openTitle'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: t('dialog.books'), extensions: BOOK_EXTENSIONS },
        { name: t('dialog.allFiles'), extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('state:load', async () => {
    const data = await readJson(stateFile(), {});
    delete data.window;
    return data;
  });

  ipcMain.handle('state:save', async (_e, state) => {
    if (resetting) return;
    const data = await readJson(stateFile(), {});
    await writeJsonAtomic(stateFile(), { ...state, window: data.window });
    autoBackup(state);
  });

  // Confirmation and message dialogs (native Windows ones)
  // AUTOTEST_AUTOCONFIRM=1: autotests answer "yes" without showing a window
  ipcMain.handle('dialog:confirm', async (_e, { title, message, detail, ok }) => {
    if (process.env.AUTOTEST_AUTOCONFIRM) return true;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title, message, detail, buttons: [ok, t('dialog.cancel')], defaultId: 1, cancelId: 1, noLink: true,
    });
    return response === 0;
  });

  ipcMain.handle('dialog:info', async (_e, { title, message, detail }) => {
    if (process.env.AUTOTEST_AUTOCONFIRM) return;
    await dialog.showMessageBox(mainWindow, { type: 'info', title, message, detail, buttons: [t('dialog.ok')], noLink: true });
  });

  // "Reset all": delete the state file and reload the window so the app starts from scratch
  ipcMain.handle('data:reset-all', async () => {
    resetting = true;
    await fs.rm(stateFile(), { force: true });
    await fs.rm(stateFile() + '.tmp', { force: true });
    mainWindow.webContents.once('did-finish-load', () => { resetting = false; });
    mainWindow.webContents.reload();
  });

  ipcMain.handle('data:open-folder', () => shell.openPath(app.getPath('userData')));

  ipcMain.handle('data:backup-info', () => ({ dir: backupDir() }));
  ipcMain.handle('data:open-backups', async () => {
    await fs.mkdir(backupDir(), { recursive: true });
    return shell.openPath(backupDir());
  });

  ipcMain.handle('book:reveal', (_e, filePath) => {
    if (isBookPath(filePath)) shell.showItemInFolder(filePath);
  });

  // The book was moved: the user points to its new location (same file type)
  ipcMain.handle('book:locate', async (_e, oldPath) => {
    const ext = path.extname(oldPath).slice(1).toLowerCase();
    let start = path.dirname(oldPath);
    try {
      await fs.access(start);
    } catch {
      start = app.getPath('documents');
    }
    const file = process.env.AUTOTEST_DIALOG_FILE ?? (await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.locateTitle', { name: path.basename(oldPath) }),
      defaultPath: start,
      properties: ['openFile'],
      filters: [{ name: t('dialog.books'), extensions: ext ? [ext] : BOOK_EXTENSIONS }, { name: t('dialog.allBooks'), extensions: BOOK_EXTENSIONS }],
    })).filePaths?.[0];
    return file && isBookPath(file) ? file : null;
  });

  // Export: the state comes from the window (fresher than the file on disk) and is written to the chosen file.
  // AUTOTEST_DIALOG_FILE: autotests supply a path instead of showing the dialog.
  ipcMain.handle('data:export', async (_e, state) => {
    await fs.mkdir(backupDir(), { recursive: true }).catch(() => {});
    const file = process.env.AUTOTEST_DIALOG_FILE ?? (await dialog.showSaveDialog(mainWindow, {
      title: t('dialog.exportTitle'),
      defaultPath: path.join(backupDir(), `chytalka-backup-${localDate()}.json`),
      filters: [{ name: t('dialog.backupFile'), extensions: ['json'] }],
    })).filePath;
    if (!file) return null;
    await fs.writeFile(file, JSON.stringify(makeBackup(state), null, 2), 'utf8');
    return file;
  });

  // Import in two steps: read and validate the file (the window shows a summary and asks for confirmation),
  // then apply it and reload the window
  let pendingImport = null;
  ipcMain.handle('data:import-read', async () => {
    pendingImport = null;
    const file = process.env.AUTOTEST_DIALOG_FILE ?? (await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.importTitle'),
      defaultPath: (await fs.stat(backupDir()).then(() => backupDir(), () => app.getPath('documents'))),
      properties: ['openFile'],
      filters: [{ name: t('dialog.backupFile'), extensions: ['json'] }, { name: t('dialog.allFiles'), extensions: ['*'] }],
    })).filePaths?.[0];
    if (!file) return null;
    let data;
    try {
      data = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    } catch {
      return { error: t('dialog.importBroken') };
    }
    // Accept both an export file and a raw state.json
    const state = data?.format === BACKUP_FORMAT ? data.state : data;
    if (!isValidState(state)) return { error: t('dialog.importNotBackup') };
    pendingImport = cleanState(state);
    const books = Object.values(pendingImport.books ?? {});
    return {
      file,
      exported: data?.format === BACKUP_FORMAT ? data.exported : null,
      books: books.length,
      bookmarks: books.reduce((sum, b) => sum + (Array.isArray(b.bookmarks) ? b.bookmarks.length : 0), 0),
    };
  });

  ipcMain.handle('data:import-apply', async () => {
    if (!pendingImport) return false;
    resetting = true;
    const current = await readJson(stateFile(), {});
    await writeJsonAtomic(stateFile(), { ...pendingImport, window: current.window });
    pendingImport = null;
    mainWindow.webContents.once('did-finish-load', () => { resetting = false; });
    mainWindow.webContents.reload();
    return true;
  });

  // Uninstall: the standard uninstaller sits next to Chytalka.exe (installed version only)
  ipcMain.handle('app:uninstall-info', async () => ({ installed: !!(await findUninstaller()) }));

  ipcMain.handle('app:uninstall', async () => {
    const uninstaller = await findUninstaller();
    if (!uninstaller) {
      shell.openExternal('ms-settings:appsfeatures');
      return 'settings';
    }
    // Launch the uninstaller directly and quit right away. It shows a welcome page first
    // and only checks whether the app is running after "Uninstall" is clicked; by then the app
    // has already quit. detached, so Windows does not kill the uninstaller together with the app.
    spawn(uninstaller, ['/currentuser'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return 'started';
  });

  // The window reports the language setting; native dialogs follow it. Returns the language actually used.
  ipcMain.handle('app:set-language', (_e, setting) => setLanguage(setting));

  ipcMain.handle('app:version', () => APP_VERSION);

  ipcMain.handle('app:initial-files', () => {
    const files = pendingFiles;
    pendingFiles = [];
    return files;
  });
}

/* ---------- Data backups ---------- */

const BACKUP_FORMAT = 'chytalka-backup';
const AUTO_BACKUP_RE = /^chytalka-auto-\d{4}-\d{2}-\d{2}\.json$/;
const AUTO_BACKUP_KEEP = 10;                 // how many days of auto backups to keep
const AUTO_BACKUP_EVERY = 5 * 60 * 1000;     // refresh the daily backup at most once every 5 minutes
let lastAutoBackup = 0;

// Documents\Chytalka: a Latin name in any interface language, safe for older tools and scripts
// (autotests override it with CHYTALKA_BACKUP_DIR so they don't write to the real Documents)
const backupDir = () => process.env.CHYTALKA_BACKUP_DIR ?? path.join(app.getPath('documents'), 'Chytalka');

// Earlier versions kept backups in Documents\Читалка. Their files are moved to the new folder once
// (a file that already exists there is not overwritten); the old folder is removed only when it's empty.
const LEGACY_BACKUP_DIR = 'Читалка';

async function migrateBackupDir() {
  const legacy = path.join(path.dirname(backupDir()), LEGACY_BACKUP_DIR);
  let files;
  try {
    files = await fs.readdir(legacy);
  } catch {
    return;
  }
  try {
    await fs.mkdir(backupDir(), { recursive: true });
    for (const name of files) {
      const target = path.join(backupDir(), name);
      const taken = await fs.access(target).then(() => true, () => false);
      if (!taken) await fs.rename(path.join(legacy, name), target);
    }
    await fs.rmdir(legacy).catch(() => {});
  } catch (err) {
    console.warn('Failed to move backups to the new folder', err);
  }
}

function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeBackup(state) {
  return { format: BACKUP_FORMAT, version: 1, exported: new Date().toISOString(), appVersion: APP_VERSION, state: cleanState(state) };
}

// Auto backup: one file per day (updated during the day), the last 10 days are kept.
// An empty history (e.g. right after "Reset all") is not saved, so the previous backup isn't overwritten.
async function autoBackup(state) {
  if (state?.settings?.autoBackup === false) return;
  if (!isObject(state?.books) || Object.keys(state.books).length === 0) return;
  const now = Date.now();
  // CHYTALKA_BACKUP_EVERY_MS is for autotests only (so they don't wait 5 minutes)
  if (now - lastAutoBackup < (Number(process.env.CHYTALKA_BACKUP_EVERY_MS) || AUTO_BACKUP_EVERY)) return;
  lastAutoBackup = now;
  try {
    const dir = backupDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `chytalka-auto-${localDate()}.json`), JSON.stringify(makeBackup(state), null, 2), 'utf8');
    const old = (await fs.readdir(dir)).filter((f) => AUTO_BACKUP_RE.test(f)).sort().slice(0, -AUTO_BACKUP_KEEP);
    for (const f of old) await fs.rm(path.join(dir, f), { force: true });
  } catch (err) {
    console.warn('Failed to save the automatic backup', err);
  }
}
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isValidState(state) {
  if (!isObject(state)) return false;
  if (!isObject(state.settings) && !isObject(state.books)) return false;
  if (state.books !== undefined && !isObject(state.books)) return false;
  return Object.values(state.books ?? {}).every(isObject);
}

// Keep only known fields (without window bounds, which depend on the monitor)
function cleanState(state) {
  const out = {};
  if (isObject(state.settings)) out.settings = state.settings;
  if (isObject(state.books)) out.books = state.books;
  if (isObject(state.reading)) out.reading = state.reading;
  if (isObject(state.session) && Array.isArray(state.session.tabs)) {
    out.session = {
      tabs: state.session.tabs.filter((t) => typeof t === 'string'),
      active: typeof state.session.active === 'string' ? state.session.active : null,
    };
  }
  return out;
}

async function findUninstaller() {
  if (!app.isPackaged) return null;
  const dir = path.dirname(process.execPath);
  try {
    const name = (await fs.readdir(dir)).find((f) => /^Uninstall .+\.exe$/i.test(f));
    return name ? path.join(dir, name) : null;
  } catch {
    return null;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    openFilesInWindow(filesFromArgv(argv));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    pendingFiles = filesFromArgv(process.argv);
    registerProtocol();
    registerIpc();
    const saved = await readJson(stateFile(), {});
    setLanguage(saved.settings?.language);
    await migrateBackupDir();
    createWindow(fitToScreen(saved.window));
  });

  app.on('window-all-closed', () => app.quit());
}
