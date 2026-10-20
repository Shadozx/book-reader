import { h, icon, debounce, basename, stripExtension } from './util.js';
import { createSettingsPanel } from './settings-panel.js';

const api = window.api;

/* ------------------------------------------------------------------
 * Settings and saved state
 * ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS = {
  theme: 'light',          // light | sepia | dark
  mode: 'scroll',          // scroll | paged
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 20,            // px
  lineHeight: 1.6,
  margin: 48,              // left/right margins, px
  maxWidth: 820,           // maximum text column width, px (0 = unlimited)
  indent: 1.5,             // paragraph indent, em
  paraSpacing: 0.3,        // spacing between paragraphs, em
  align: 'justify',        // justify | left
  spread: true,            // two pages side by side in paged mode on a wide screen
  invertDark: true,        // invert PDF/DjVu pages in the dark theme
  zoom: 'auto',            // default PDF/DjVu zoom
  autoBackup: true,        // daily backup to Documents\Читалка
};

// Default reading speed; it then adapts to the user
const DEFAULT_READING = {
  chars: 1100,   // text characters per minute (FB2/EPUB)
  pages: 0.7,    // pages per minute (PDF/DjVu)
};

const store = {
  settings: { ...DEFAULT_SETTINGS },
  reading: { ...DEFAULT_READING },
  books: {},               // path → { title, author, format, location, progress, lastOpened }
  session: { tabs: [], active: null },
};

const saveStore = debounce(() => {
  api.saveState({ settings: store.settings, books: store.books, session: store.session, reading: store.reading });
}, 400);

function bookRecord(path) {
  return (store.books[path] ??= { title: stripExtension(basename(path)) });
}

/* ------------------------------------------------------------------
 * Format detection and viewer creation
 * ------------------------------------------------------------------ */

function detectFormat(path, bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64));
  const ext = path.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? '';
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('AT&T')) return 'djvu';
  if (head.startsWith('PK')) {
    if (ext === 'epub' || head.includes('mimetypeapplication/epub+zip')) return 'epub';
    return 'fb2';           // .fb2.zip is an archive with an FB2 inside
  }
  if (/^(\xEF\xBB\xBF)?\s*</.test(head)) return 'fb2';
  return { djv: 'djvu' }[ext] ?? ext;
}

// Format → viewer factory (modules are loaded only when needed)
const VIEWERS = {
  async fb2(ctx) {
    const [{ parseFb2 }, { createFlowViewer }] = await Promise.all([import('./formats/fb2.js'), import('./viewers/flow.js')]);
    return createFlowViewer({ ...ctx, book: await parseFb2(ctx.bytes) });
  },
  async pdf(ctx) {
    const [{ openPdf }, { createFixedViewer }] = await Promise.all([import('./formats/pdf.js'), import('./viewers/fixed.js')]);
    return createFixedViewer({ ...ctx, source: await openPdf(ctx.bytes) });
  },
  async djvu(ctx) {
    const [{ openDjvu }, { createFixedViewer }] = await Promise.all([import('./formats/djvu.js'), import('./viewers/fixed.js')]);
    return createFixedViewer({ ...ctx, source: await openDjvu(ctx.bytes) });
  },
  async epub(ctx) {
    const [{ parseEpub }, { createFlowViewer }] = await Promise.all([import('./formats/epub.js'), import('./viewers/flow.js')]);
    return createFlowViewer({ ...ctx, book: await parseEpub(ctx.bytes) });
  },
};

/*
 * Viewer interface:
 *   meta: { title, author }
 *   toc: [{ label, target, children? }]
 *   kind: 'flow' (FB2/EPUB) | 'fixed' (PDF/DjVu)
 *   getLocation(), goTo(target), progress() → { text, value }
 *   applySettings(settings), onShow(), handleKey(event) → bool, destroy()
 *   for 'fixed': zoomIn(), zoomOut(), setZoom(value), zoomValue
 */
async function createViewer(format, context) {
  const factory = VIEWERS[format];
  if (!factory) return null;
  return factory(context);
}

/* ------------------------------------------------------------------
 * Tabs
 * ------------------------------------------------------------------ */

const tabs = [];
let activeTab = null;

const els = {
  tabs: document.getElementById('tabs'),
  panes: document.getElementById('panes'),
  toolbar: document.getElementById('toolbar'),
  welcome: document.getElementById('welcome'),
  title: document.getElementById('book-title'),
  author: document.getElementById('book-author'),
  progress: document.getElementById('progress'),
  zoomControls: document.getElementById('zoom-controls'),
  zoomSelect: document.getElementById('zoom-select'),
  modeSwitch: document.getElementById('mode-switch'),
  tocPanel: document.getElementById('toc-panel'),
  tocList: document.getElementById('toc-list'),
  recentBlock: document.getElementById('recent-block'),
  recentList: document.getElementById('recent-list'),
  dropOverlay: document.getElementById('drop-overlay'),
};

class Tab {
  constructor(path) {
    this.path = path;
    this.format = null;
    this.viewer = null;
    this.record = bookRecord(path);

    this.titleEl = h('span', { class: 'tab-title' }, this.record.title);
    this.formatEl = h('span', { class: 'tab-format' });
    const closeBtn = h('button', { class: 'icon-btn', title: 'Закрити (Ctrl+W)' }, icon('x', 14));
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(this);
    });

    this.tabEl = h('div', { class: 'tab', role: 'tab', title: path }, this.formatEl, this.titleEl, closeBtn);
    this.tabEl.addEventListener('click', () => activateTab(this));
    this.tabEl.addEventListener('auxclick', (e) => {
      if (e.button === 1) closeTab(this);
    });

    this.paneEl = h('div', { class: 'pane', hidden: true });
  }

  showMessage(kind, text, detail) {
    const iconEl = kind === 'loading' ? h('div', { class: 'spinner' }) : icon(kind === 'error' ? 'alert' : 'book', 40);
    this.paneEl.replaceChildren(
      h('div', { class: `pane-message ${kind}` }, iconEl, h('div', {}, text), detail ? h('code', {}, detail) : null),
    );
  }

  setTitle(title) {
    this.titleEl.textContent = title;
    this.tabEl.title = `${title}\n${this.path}`;
  }

  async load() {
    this.showMessage('loading', 'Відкриваю книгу…');
    try {
      const { data } = await api.readBook(this.path);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.format = detectFormat(this.path, bytes);
      this.formatEl.textContent = this.format;
      this.record.format = this.format;

      this.viewer = await createViewer(this.format, {
        bytes,
        path: this.path,
        container: this.paneEl,
        settings: store.settings,
        location: this.record.location,
        onLocationChange: () => this.onLocationChange(),
        onTocChange: () => this === activeTab && updateToolbar(),
      });

      if (!this.viewer) {
        const mb = (bytes.byteLength / 1048576).toFixed(1);
        this.showMessage('info', `Формат ${this.format.toUpperCase()} розпізнано (${mb} МБ).`, 'Показ цього формату з’явиться на наступних етапах.');
      } else {
        const { title, author } = this.viewer.meta;
        if (title) this.record.title = title;
        this.record.author = author || '';
        this.setTitle(this.record.title);
      }
    } catch (err) {
      console.error(err);
      this.viewer = null;
      this.showMessage('error', 'Не вдалося відкрити книгу', err?.message ?? String(err));
    }
    this.record.lastOpened = Date.now();
    saveStore();
    if (this === activeTab) updateToolbar();
  }

  onLocationChange() {
    if (!this.viewer) return;
    trackReadingSpeed(this);
    this.record.location = this.viewer.getLocation();
    this.record.progress = this.viewer.progress().value;
    saveStore();
    if (this === activeTab) {
      updateProgress();
      updateZoom();
    }
  }

  destroy() {
    try {
      this.viewer?.destroy();
    } catch (err) {
      console.error('Помилка під час закриття книги', err);
    }
    this.tabEl.remove();
    this.paneEl.remove();
  }
}

function openBook(path, { activate = true } = {}) {
  if (activate) closeLibrary();
  const existing = tabs.find((t) => t.path.toLowerCase() === path.toLowerCase());
  if (existing) {
    if (activate) activateTab(existing);
    return existing;
  }
  const tab = new Tab(path);
  tabs.push(tab);
  els.tabs.append(tab.tabEl);
  els.panes.append(tab.paneEl);
  tab.setTitle(tab.record.title);
  if (activate || !activeTab) activateTab(tab);
  tab.load();
  saveSession();
  return tab;
}

function activateTab(tab) {
  if (activeTab === tab) return;
  closeSearch();
  if (activeTab) {
    activeTab.tabEl.classList.remove('active');
    activeTab.paneEl.hidden = true;
  }
  activeTab = tab;
  if (tab) {
    tab.tabEl.classList.add('active');
    tab.paneEl.hidden = false;
    tab.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    tab.viewer?.onShow();
  }
  updateToolbar();
  saveSession();
}

function closeTab(tab) {
  const index = tabs.indexOf(tab);
  if (index < 0) return;
  if (tab === activeTab) closeSearch();
  tab.onLocationChange();
  tabs.splice(index, 1);
  tab.destroy();
  if (activeTab === tab) {
    activeTab = null;
    activateTab(tabs[Math.min(index, tabs.length - 1)] ?? null);
  }
  saveSession();
}

function cycleTab(step) {
  if (tabs.length < 2) return;
  const index = tabs.indexOf(activeTab);
  activateTab(tabs[(index + step + tabs.length) % tabs.length]);
}

function saveSession() {
  store.session = { tabs: tabs.map((t) => t.path), active: activeTab?.path ?? null };
  saveStore();
}

/* ------------------------------------------------------------------
 * Toolbar
 * ------------------------------------------------------------------ */

function updateToolbar() {
  const tab = activeTab;
  els.toolbar.hidden = !tab;
  els.welcome.hidden = !!tab;
  els.panes.hidden = !tab;
  if (!tab) {
    els.tocPanel.hidden = true;
    renderRecent();
    document.title = 'Читалка';
    return;
  }
  els.title.textContent = tab.record.title;
  els.author.textContent = tab.record.author ?? '';
  document.title = `${tab.record.title} — Читалка`;

  const viewer = tab.viewer;
  els.zoomControls.hidden = viewer?.kind !== 'fixed';
  els.modeSwitch.hidden = !viewer;
  document.getElementById('btn-toc').disabled = !viewer;
  document.getElementById('btn-bookmark').disabled = !viewer;
  if (!viewer) els.tocPanel.hidden = true;
  updateBookmarkButton();
  if (!els.tocPanel.hidden && sidePanelView === 'bookmarks') renderBookmarks();
  renderToc();
  updateModeSwitch();
  updateZoom();
  updateProgress();
}

function updateProgress() {
  const viewer = activeTab?.viewer;
  if (!els.progress.querySelector('input')) els.progress.textContent = viewer?.progress().text ?? '';
  updateChapter();
  highlightToc();
  updateBookmarkButton();
}

// Reading speed: compare how much was read over a period of time. Jumps (TOC, search),
// going back and long breaks are ignored; only regular reading counts.
const SPEED_LIMITS = { chars: [150, 6000], pages: [0.05, 8] };

function trackReadingSpeed(tab) {
  const pos = tab.viewer.readingPosition?.();
  if (!pos) return;
  const now = Date.now();
  const last = tab.readSample;
  if (!last || last.unit !== pos.unit) {
    tab.readSample = { ...pos, time: now };
    return;
  }
  const minutes = (now - last.time) / 60000;
  if (minutes < 0.05) return;   // less than 3 seconds: keep accumulating
  const rate = (pos.value - last.value) / minutes;
  const [low, high] = SPEED_LIMITS[pos.unit];
  if (pos.value > last.value && minutes <= 10 && rate >= low && rate <= high) {
    store.reading[pos.unit] = store.reading[pos.unit] * 0.85 + rate * 0.15;
  }
  tab.readSample = { ...pos, time: now };
}

function formatMinutes(minutes) {
  if (minutes < 1) return 'менше хвилини';
  if (minutes < 60) return `≈ ${Math.round(minutes)} хв`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `≈ ${h} год${m ? ` ${m} хв` : ''}`;
}

// Second line under the title: current chapter and how much of it is read (or the author if there is no TOC)
function updateChapter() {
  const bar = document.getElementById('chapter-bar');
  const author = activeTab?.record.author ?? '';
  const info = activeTab?.viewer?.chapterInfo?.();
  els.title.title = [activeTab?.record.title, author].filter(Boolean).join('\n');
  if (!info) {
    els.author.textContent = author;
    els.author.title = '';
    bar.hidden = true;
    return;
  }
  const percent = Math.floor(info.progress * 100);
  const detail = info.pages ? `стор. ${info.page} з ${info.pages}` : `прочитано ${percent}%`;
  const speed = store.reading[info.unit];
  const left = info.remaining > 0 && speed ? ` · ще ${formatMinutes(info.remaining / speed)}` : '';
  const speedText = info.unit === 'pages'
    ? `${(1 / speed).toFixed(1)} хв на сторінку`
    : `${Math.round(speed)} знаків за хвилину`;
  els.author.textContent = `${info.label} · ${detail}${left}`;
  els.author.title = [
    `Розділ: ${info.label}`,
    `${detail}${info.pages ? ` (${percent}%)` : ''}`,
    left && `До кінця розділу ${formatMinutes(info.remaining / speed)} (ваша швидкість: ${speedText})`,
    author && `Автор: ${author}`,
  ].filter(Boolean).join('\n');
  bar.hidden = false;
  bar.title = `Прочитано ${percent}% розділу`;
  bar.firstElementChild.style.width = `${info.progress * 100}%`;
}

let highlightedToc = null;
function highlightToc() {
  const index = activeTab?.viewer?.currentTocIndex?.() ?? -1;
  const item = index >= 0 ? els.tocList.querySelector(`[data-index="${index}"]`) : null;
  if (item === highlightedToc) return;
  highlightedToc?.classList.remove('current');
  highlightedToc = item;
  if (item) {
    item.classList.add('current');
    if (!els.tocPanel.hidden) item.scrollIntoView({ block: 'nearest' });
  }
}

function updateModeSwitch() {
  for (const btn of els.modeSwitch.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.mode === store.settings.mode);
  }
}

function updateZoom() {
  const viewer = activeTab?.viewer;
  if (viewer?.kind !== 'fixed') return;
  const value = String(viewer.zoomValue);
  const custom = els.zoomSelect.querySelector('option[value="custom"]');
  const preset = [...els.zoomSelect.options].find((o) => o.value === value);
  if (preset) {
    els.zoomSelect.value = value;
  } else {
    custom.textContent = `${Math.round(viewer.zoomValue * 100)}%`;
    els.zoomSelect.value = 'custom';
  }
}

function renderToc() {
  const toc = activeTab?.viewer?.toc ?? [];
  let index = 0;
  highlightedToc = null;
  const build = (items, depth) =>
    items.map((item) => {
      const link = h('a', { class: 'toc-item', style: `padding-left:${14 + depth * 14}px`, href: '#', 'data-index': index++, title: item.label }, item.label);
      link.addEventListener('click', (e) => {
        e.preventDefault();
        activeTab?.viewer?.goTo(item.target);
      });
      return [link, item.children ? build(item.children, depth + 1) : null];
    });
  els.tocList.replaceChildren(...build(toc, 0).flat(Infinity).filter(Boolean));
  if (!toc.length) els.tocList.replaceChildren(h('p', { class: 'panel-empty' }, 'У цій книзі немає змісту.'));
}

function setTheme(theme) {
  store.settings.theme = theme;
  if (settingsPanel?.open) settingsPanel.sync();
  document.documentElement.dataset.theme = theme;
  updateThemeButton();
  applySettingsToViewers();
}

function updateThemeButton() {
  const next = { light: 'sepia', sepia: 'dark', dark: 'light' }[store.settings.theme];
  const btn = document.getElementById('btn-theme');
  btn.replaceChildren(icon({ light: 'sun', sepia: 'coffee', dark: 'moon' }[store.settings.theme]));
  btn.title = `Тема: ${{ light: 'світла', sepia: 'сепія', dark: 'темна' }[store.settings.theme]} (натисніть — ${{ light: 'світла', sepia: 'сепія', dark: 'темна' }[next]})`;
}

function setMode(mode) {
  store.settings.mode = mode;
  if (settingsPanel?.open) settingsPanel.sync();
  updateModeSwitch();
  applySettingsToViewers();
}

function updateSettings(patch) {
  Object.assign(store.settings, patch);
  document.documentElement.dataset.theme = store.settings.theme;
  updateThemeButton();
  if (settingsPanel?.open) settingsPanel.sync();
  updateModeSwitch();
  applySettingsToViewers();
}

function applySettingsToViewers() {
  for (const tab of tabs) tab.viewer?.applySettings(store.settings);
  updateProgress();
  saveStore();
}

/* ------------------------------------------------------------------
 * Welcome screen
 * ------------------------------------------------------------------ */

async function renderRecent() {
  const recent = Object.entries(store.books)
    .filter(([, b]) => b.lastOpened)
    .sort((a, b) => b[1].lastOpened - a[1].lastOpened)
    .slice(0, 20);
  els.recentBlock.hidden = recent.length === 0;
  const total = Object.values(store.books).filter((b) => b.lastOpened || b.location).length;
  document.getElementById('btn-library-all').textContent = `Уся бібліотека (${total})`;
  const items = await Promise.all(
    recent.map(async ([path, book]) => {
      const exists = await api.bookExists(path);
      const removeBtn = h('button', { class: 'icon-btn', title: 'Прибрати зі списку' }, icon('x', 14));
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        delete store.books[path];
        saveStore();
        renderRecent();
      });
      const item = h(
        'li',
        { class: `recent-item${exists ? '' : ' missing'}`, title: exists ? path : `Файл не знайдено: ${path}` },
        h('span', { class: 'badge' }, book.format ?? '?'),
        h('div', { class: 'recent-main' },
          h('div', { class: 'recent-title' }, book.title),
          h('div', { class: 'recent-sub' }, [book.author, path].filter(Boolean).join(' · '))),
        book.progress != null ? h('span', { class: 'recent-progress' }, `${Math.round(book.progress * 100)}%`) : null,
        removeBtn,
      );
      if (exists) item.addEventListener('click', () => openBook(path));
      return item;
    }),
  );
  els.recentList.replaceChildren(...items);
}

/* ------------------------------------------------------------------
 * Opening files: dialog, drag and drop, launch arguments
 * ------------------------------------------------------------------ */

async function openDialog() {
  const files = await api.openDialog();
  files.forEach((f, i) => openBook(f, { activate: i === files.length - 1 }));
}

function setupDragAndDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    depth++;
    els.dropOverlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      els.dropOverlay.hidden = true;
    }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    els.dropOverlay.hidden = true;
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    paths.forEach((p, i) => openBook(p, { activate: i === paths.length - 1 }));
  });
}

/* ------------------------------------------------------------------
 * Hotkeys
 * ------------------------------------------------------------------ */

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'o') openDialog();
    else if (ctrl && key === 'w') activeTab && closeTab(activeTab);
    else if (ctrl && e.key === 'Tab') cycleTab(e.shiftKey ? -1 : 1);
    else if (ctrl && e.key === 'PageDown') cycleTab(1);
    else if (ctrl && e.key === 'PageUp') cycleTab(-1);
    else if (ctrl && /^[1-9]$/.test(e.key)) {
      const tab = e.key === '9' ? tabs.at(-1) : tabs[Number(e.key) - 1];
      if (tab) activateTab(tab);
    } else if (ctrl && key === 'b') toggleToc();
    else if (ctrl && key === 'g') openGoto();
    else if (ctrl && key === 'f') openSearch();
    else if (ctrl && key === 'd') toggleBookmark();
    else if (ctrl && key === 'l') toggleLibrary();
    else if (e.key === 'Escape' && libraryOpen()) closeLibrary();
    else if (e.key === 'F3') searchStep(e.shiftKey ? -1 : 1);
    else if (ctrl && (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+')) zoomOrFont(1);
    else if (ctrl && (e.code === 'Minus' || e.code === 'NumpadSubtract')) zoomOrFont(-1);
    else if (ctrl && (e.code === 'Digit0' || e.code === 'Numpad0')) resetZoomOrFont();
    else if (e.key === 'Escape' && settingsPanel.open) setSettingsOpen(false);
    else if (e.target.closest?.('input, select, textarea')) return;
    else if (activeTab?.viewer?.handleKey?.(e)) { /* handled by the viewer */ }
    else return;
    e.preventDefault();
  });
}

/* ------------------------------------------------------------------
 * Settings panel, font size, notifications
 * ------------------------------------------------------------------ */

let settingsPanel = null;

/* ---------- Data: reset and uninstall ---------- */

function resetSettings() {
  updateSettings({ ...DEFAULT_SETTINGS });
  settingsPanel.sync();
  toast('Налаштування скинуто');
}

async function clearHistory() {
  const ok = await api.confirm({
    title: 'Очистити історію',
    message: 'Очистити історію читання?',
    detail: 'Буде видалено список нещодавніх книг, місця читання та закладки всіх книг. Відкриті вкладки закриються.\n\nСамі файли книг не зачіпаються. Автоматичні резервні копії в «Документи\\Читалка» лишаються — з них можна відновитися через «Імпортувати дані…».',
    ok: 'Очистити',
  });
  if (!ok) return;
  for (const tab of [...tabs]) closeTab(tab);
  store.books = {};
  store.session = { tabs: [], active: null };
  saveStore.flush();
  setSettingsOpen(false);
  renderRecent();
  toast('Історію читання очищено');
}

async function resetAll() {
  const ok = await api.confirm({
    title: 'Скинути все',
    message: 'Скинути всі дані програми?',
    detail: 'Налаштування, історія читання, закладки, вкладки та швидкість читання повернуться до початкового стану, а програма перезапуститься.\n\nСамі файли книг не зачіпаються. Автоматичні резервні копії в «Документи\\Читалка» лишаються — з них можна відновитися через «Імпортувати дані…».',
    ok: 'Скинути все',
  });
  if (ok) await api.resetAll();
}

async function exportData() {
  // Put the current reading positions of open books into the state before saving
  for (const tab of tabs) tab.onLocationChange();
  const state = { settings: store.settings, books: store.books, session: store.session, reading: store.reading };
  const file = await api.exportData(state);
  if (file) toast(`Дані збережено: ${basename(file)}`);
}

async function importData() {
  const info = await api.importRead();
  if (!info) return;
  if (info.error) {
    await api.info({ title: 'Імпорт даних', message: 'Не вдалося імпортувати дані', detail: info.error });
    return;
  }
  const created = info.exported ? new Date(info.exported).toLocaleString('uk-UA') : 'невідомо';
  const ok = await api.confirm({
    title: 'Імпорт даних',
    message: 'Замінити поточні дані даними з резервної копії?',
    detail: `Файл: ${info.file}\nСтворено: ${created}\nКниг: ${info.books}, закладок: ${info.bookmarks}\n\nПоточні налаштування, історію читання та закладки буде замінено, програма перезапуститься. Файли книг не зачіпаються.`,
    ok: 'Імпортувати',
  });
  if (!ok) return;
  saveStore.cancel();
  await api.importApply();
}

async function uninstallApp() {
  const { installed } = await api.uninstallInfo();
  if (!installed) {
    await api.info({
      title: 'Видалення програми',
      message: 'Видалення доступне лише у встановленій програмі.',
      detail: 'Зараз «Читалка» запущена з папки проєкту (npm start). Щоб прибрати її, достатньо видалити папку проєкту.',
    });
    return;
  }
  const ok = await api.confirm({
    title: 'Видалити програму',
    message: 'Видалити «Читалку» з комп\'ютера?',
    detail: 'Програма закриється й відкриється стандартний деінсталятор Windows. Він спитає, чи видаляти також ваші налаштування та закладки.\n\nФайли книг не видаляються.',
    ok: 'Видалити',
  });
  if (ok) await api.uninstall();
}

const dataControls = {};

function createDataSection() {
  const button = (label, handler, danger = false) => {
    const btn = h('button', { type: 'button', class: `data-btn${danger ? ' danger' : ''}` }, label);
    btn.addEventListener('click', handler);
    return btn;
  };
  const folder = h('button', { type: 'button', class: 'link-btn' }, 'Відкрити папку з даними');
  folder.addEventListener('click', () => api.openDataFolder());
  dataControls.autoBackup = h('input', { type: 'checkbox' });
  dataControls.autoBackup.addEventListener('change', () => updateSettings({ autoBackup: dataControls.autoBackup.checked }));
  dataControls.backupDir = h('div', { class: 'backup-dir muted small' });
  api.backupInfo().then(({ dir }) => { dataControls.backupDir.textContent = dir; });
  const backups = h('button', { type: 'button', class: 'link-btn' }, 'Відкрити папку з резервними копіями');
  backups.addEventListener('click', () => api.openBackups());
  return h('section', { class: 'settings-section data-section' },
    h('h3', {}, 'Дані'),
    button('Скинути налаштування', resetSettings),
    button('Очистити історію читання…', clearHistory),
    button('Скинути все й перезапустити…', resetAll, true),
    button('Експортувати дані…', exportData),
    button('Імпортувати дані…', importData),
    h('label', { class: 'check' }, dataControls.autoBackup, h('span', {}, 'Автоматична резервна копія щодня (останні 10 днів)')),
    dataControls.backupDir,
    backups,
    folder,
    h('h3', {}, 'Програма'),
    button('Видалити програму…', uninstallApp, true),
  );
}

function setupSettingsPanel() {
  settingsPanel = createSettingsPanel({
    getSettings: () => store.settings,
    update: updateSettings,
    defaults: DEFAULT_SETTINGS,
    extra: createDataSection(),
  });
  document.getElementById('main').append(settingsPanel.el);
  const btn = document.getElementById('btn-settings');
  btn.addEventListener('click', () => setSettingsOpen(!settingsPanel.open));
  // A click outside the panel closes it
  document.addEventListener('mousedown', (e) => {
    if (settingsPanel.open && !settingsPanel.el.contains(e.target) && !btn.contains(e.target)) setSettingsOpen(false);
  });
}

function setSettingsOpen(open) {
  if (open && dataControls.autoBackup) dataControls.autoBackup.checked = store.settings.autoBackup !== false;
  settingsPanel.setOpen(open, { textApplies: activeTab?.viewer?.kind !== 'fixed' });
  document.getElementById('btn-settings').classList.toggle('active', open);
}

function changeFontSize(delta) {
  const size = Math.min(40, Math.max(12, store.settings.fontSize + delta));
  if (size !== store.settings.fontSize) updateSettings({ fontSize: size });
  toast(`Шрифт: ${size} px`);
}

// Ctrl +/−: font size in text books, zoom in PDF/DjVu
function zoomOrFont(direction) {
  const viewer = activeTab?.viewer;
  if (!viewer) return;
  if (viewer.kind === 'fixed') {
    if (direction > 0) viewer.zoomIn();
    else viewer.zoomOut();
    toast(`Масштаб: ${Math.round(viewer.scale * 100)}%`);
  } else {
    changeFontSize(direction);
  }
}

function resetZoomOrFont() {
  const viewer = activeTab?.viewer;
  if (!viewer) return;
  if (viewer.kind === 'fixed') {
    viewer.setZoom(store.settings.mode === 'paged' ? 'page' : 'auto');
    toast(store.settings.mode === 'paged' ? 'Масштаб: цілком' : 'Масштаб: авто');
  } else {
    updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize });
    toast(`Шрифт: ${DEFAULT_SETTINGS.fontSize} px`);
  }
}

// Ctrl+wheel in text books changes the font size (PDF/DjVu handle zoom themselves)
function setupWheelZoom() {
  let accum = 0;
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (activeTab?.viewer?.kind !== 'flow') return;
    accum += e.deltaY;
    if (Math.abs(accum) >= 50) {
      changeFontSize(accum < 0 ? 1 : -1);
      accum = 0;
    }
  }, { passive: false });
}

let toastTimer = 0;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

/* ------------------------------------------------------------------
 * Library (Ctrl+L): the books the app remembers
 * ------------------------------------------------------------------ */

const libraryEl = document.getElementById('library');
const library = { sort: 'recent', query: '', list: null, summary: null, search: null };

const libraryOpen = () => !libraryEl.hidden;

function openLibrary() {
  setSettingsOpen(false);
  libraryEl.hidden = false;
  document.getElementById('btn-library').classList.add('active');
  renderLibrary();
  library.search.focus();
}

function closeLibrary() {
  libraryEl.hidden = true;
  document.getElementById('btn-library').classList.remove('active');
}

function toggleLibrary() {
  if (libraryOpen()) closeLibrary();
  else openLibrary();
}

// Ukrainian plural forms: one (1, 21), few (2–4, 22), many (5–20, 11, 25)
function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatAgo(time) {
  if (!time) return 'ще не відкривали';
  const date = new Date(time);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86400000);
  const hm = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  if (days <= 0) return `сьогодні о ${hm}`;
  if (days === 1) return `вчора о ${hm}`;
  if (days < 7) return `${days} дн. тому`;
  return date.toLocaleDateString('uk-UA');
}

// The book was moved: all its data (reading position, bookmarks) moves to the new path
function relinkBook(oldPath, newPath) {
  if (oldPath.toLowerCase() === newPath.toLowerCase()) return;
  const record = store.books[oldPath];
  delete store.books[oldPath];
  store.books[newPath] = { ...store.books[newPath], ...record };
  saveStore();
}

function setupLibrary() {
  document.getElementById('btn-library').append(icon('library'));
  document.getElementById('btn-library').addEventListener('click', toggleLibrary);
  document.getElementById('btn-library-all').addEventListener('click', openLibrary);

  library.search = h('input', { class: 'library-search', type: 'search', placeholder: 'Пошук за назвою, автором чи шляхом', 'aria-label': 'Пошук у бібліотеці' });
  library.search.addEventListener('input', () => {
    library.query = library.search.value.trim().toLowerCase();
    renderLibrary();
  });
  library.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLibrary();
      e.stopPropagation();
    }
  });
  const sort = h('select', { class: 'library-sort', 'aria-label': 'Сортування' },
    h('option', { value: 'recent' }, 'Нещодавні'),
    h('option', { value: 'title' }, 'За назвою'),
    h('option', { value: 'progress' }, 'За прогресом'));
  sort.addEventListener('change', () => {
    library.sort = sort.value;
    renderLibrary();
  });
  const close = h('button', { class: 'icon-btn', title: 'Закрити (Esc)' }, icon('x'));
  close.addEventListener('click', closeLibrary);
  library.summary = h('div', { class: 'library-summary' });
  library.list = h('div', { class: 'library-list' });
  libraryEl.append(
    h('div', { class: 'library-inner' },
      h('div', { class: 'library-head' }, h('h1', {}, 'Бібліотека'), library.search, sort, close),
      library.summary,
      library.list),
  );
}

async function renderLibrary() {
  const entries = Object.entries(store.books).filter(([, b]) => b.lastOpened || b.location);
  const exists = await Promise.all(entries.map(([filePath]) => api.bookExists(filePath)));
  const openPaths = new Set(tabs.map((t) => t.path.toLowerCase()));
  let items = entries.map(([filePath, book], i) => ({ filePath, book, exists: exists[i], open: openPaths.has(filePath.toLowerCase()) }));

  // Summary: what the app remembers
  const bookmarks = items.reduce((sum, x) => sum + (x.book.bookmarks?.length ?? 0), 0);
  const withPlace = items.filter((x) => x.book.location).length;
  const missing = items.filter((x) => !x.exists).length;
  const dataLink = h('button', { type: 'button', class: 'link-btn' }, 'папка з даними');
  dataLink.addEventListener('click', () => api.openDataFolder());
  const backupsLink = h('button', { type: 'button', class: 'link-btn' }, 'резервні копії');
  backupsLink.addEventListener('click', () => api.openBackups());
  library.summary.replaceChildren(
    h('div', { class: 'library-stats' },
      h('span', {}, h('b', {}, items.length), ` ${plural(items.length, 'книга', 'книги', 'книг')}`),
      h('span', {}, h('b', {}, withPlace), ' з місцем читання'),
      h('span', {}, h('b', {}, bookmarks), ` ${plural(bookmarks, 'закладка', 'закладки', 'закладок')}`),
      missing ? h('span', { class: 'warn' }, h('b', {}, missing), ` ${plural(missing, 'файл', 'файли', 'файлів')} не знайдено`) : null),
    h('p', { class: 'muted' },
      'Для кожної книги програма пам\'ятає шлях до файлу, назву й автора, місце читання, прогрес і закладки. ',
      'Самі книги не копіюються: якщо файл перемістити, натисніть «Знайти файл…» — і дані перейдуть на нове місце. ',
      dataLink, ' · ', backupsLink),
  );

  if (library.query) {
    items = items.filter(({ filePath, book }) => [book.title, book.author, filePath].some((s) => s?.toLowerCase().includes(library.query)));
  }
  const by = {
    recent: (a, b) => (b.book.lastOpened ?? 0) - (a.book.lastOpened ?? 0),
    title: (a, b) => (a.book.title ?? '').localeCompare(b.book.title ?? '', 'uk'),
    progress: (a, b) => (b.book.progress ?? 0) - (a.book.progress ?? 0),
  };
  items.sort(by[library.sort]);

  if (!items.length) {
    library.list.replaceChildren(h('p', { class: 'panel-empty' }, entries.length ? 'Нічого не знайдено.' : 'Програма ще не пам\'ятає жодної книги — відкрийте першу через «+» або Ctrl+O.'));
    return;
  }

  library.list.replaceChildren(...items.map(({ filePath, book, exists: ok, open }) => {
    const percent = Math.floor((book.progress ?? 0) * 100);
    const marks = book.bookmarks?.length ?? 0;
    const action = (label, handler, cls = '') => {
      const b = h('button', { type: 'button', class: `lib-btn ${cls}` }, label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        handler();
      });
      return b;
    };
    const actions = [];
    if (ok) {
      actions.push(action(open ? 'Перейти' : 'Відкрити', () => {
        closeLibrary();
        openBook(filePath);
      }, 'primary'));
      actions.push(action('Показати в папці', () => api.revealBook(filePath)));
    } else {
      actions.push(action('Знайти файл…', async () => {
        const found = await api.locateBook(filePath);
        if (!found) return;
        relinkBook(filePath, found);
        toast('Книгу знайдено — місце читання й закладки збережено');
        renderLibrary();
        renderRecent();
      }, 'primary'));
    }
    const forget = action('Забути', () => {
      delete store.books[filePath];
      saveStore();
      toast(`«${book.title}» прибрано з бібліотеки`);
      renderLibrary();
      renderRecent();
    }, 'danger');
    if (open) {
      forget.disabled = true;
      forget.title = 'Спершу закрийте вкладку з цією книгою';
    }
    actions.push(forget);

    const row = h('div', { class: `lib-item${ok ? '' : ' missing'}`, title: filePath },
      h('span', { class: 'badge' }, book.format ?? '?'),
      h('div', { class: 'lib-main' },
        // The title is truncated on its own, so the chips stay visible even with a long title
        h('div', { class: 'lib-title' }, h('span', { class: 'lib-name' }, book.title),
          open ? h('span', { class: 'chip' }, 'відкрита') : null,
          ok ? null : h('span', { class: 'chip warn' }, 'файл не знайдено')),
        h('div', { class: 'lib-sub' }, [book.author, filePath].filter(Boolean).join(' · '))),
      h('div', { class: 'lib-progress', title: book.location ? `Прочитано ${percent}%` : 'Ще не читали' },
        h('div', { class: 'lib-bar' }, h('span', { style: `width:${percent}%` })),
        h('span', {}, `${percent}%`)),
      h('div', { class: 'lib-meta' },
        h('div', {}, formatAgo(book.lastOpened)),
        marks ? h('div', {}, icon('bookmark', 12), ` ${marks}`) : null),
      h('div', { class: 'lib-actions' }, actions),
    );
    if (ok) row.addEventListener('dblclick', () => {
      closeLibrary();
      openBook(filePath);
    });
    return row;
  }));
}

/* ------------------------------------------------------------------
 * Search in the book (Ctrl+F)
 * ------------------------------------------------------------------ */

const searchEls = {
  bar: document.getElementById('search-bar'),
  input: document.getElementById('search-input'),
  count: document.getElementById('search-count'),
};
let searchedQuery = null;   // the query that already has results

function showSearchState(r) {
  let text;
  if (r.noText) text = 'У книзі немає тексту для пошуку';
  else if (!searchEls.input.value.trim()) text = '';
  else if (r.count === 0) text = r.done === false ? `Шукаю… ${r.scanned ?? ''}/${r.total ?? ''}` : 'Не знайдено';
  else text = `${r.index + 1} / ${r.count}${r.capped ? '+' : ''}${r.done === false ? ' …' : ''}`;
  searchEls.count.textContent = text;
  searchEls.count.classList.toggle('none', r.count === 0 && r.done !== false && !!searchEls.input.value.trim());
}

function runSearch() {
  const viewer = activeTab?.viewer;
  if (!viewer?.search) return;
  searchedQuery = searchEls.input.value;
  viewer.search(searchedQuery, showSearchState);
}

const runSearchSoon = debounce(runSearch, 300);

function searchStep(direction) {
  const viewer = activeTab?.viewer;
  if (!viewer?.search) return;
  if (searchedQuery !== searchEls.input.value) return runSearch();
  const r = viewer.searchStep(direction);
  showSearchState({ ...r, done: true });
}

function openSearch() {
  if (!activeTab?.viewer?.search) return;
  searchEls.bar.hidden = false;
  searchEls.input.focus();
  searchEls.input.select();
}

function closeSearch() {
  if (searchEls.bar.hidden) return;
  searchEls.bar.hidden = true;
  searchedQuery = null;
  searchEls.count.textContent = '';
  for (const tab of tabs) tab.viewer?.clearSearch?.();
}

function setupSearch() {
  const btn = (id, iconName, handler) => {
    const el = document.getElementById(id);
    el.append(icon(iconName));
    el.addEventListener('click', handler);
  };
  btn('btn-search-prev', 'chevronUp', () => searchStep(-1));
  btn('btn-search-next', 'chevronDown', () => searchStep(1));
  btn('btn-search-close', 'x', closeSearch);
  searchEls.input.addEventListener('input', runSearchSoon);
  searchEls.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearchSoon.cancel?.();
      searchStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      closeSearch();
    } else if (!(e.ctrlKey && ['f', 'w', 'tab'].includes(e.key.toLowerCase()))) {
      return;
    }
    e.stopPropagation();
  });
}

/* ------------------------------------------------------------------
 * Bookmarks (Ctrl+D) and the "Contents / Bookmarks" side panel
 * ------------------------------------------------------------------ */

const bookmarkList = document.getElementById('bookmark-list');
let sidePanelView = 'toc';

const sameLocation = (a, b) =>
  a && b && (Number.isInteger(a.page) ? a.page === b.page : a.c === b.c && a.b === b.b);

function flatToc(viewer) {
  const flat = [];
  const walk = (items) => items.forEach((it) => { flat.push(it); if (it.children) walk(it.children); });
  walk(viewer?.toc ?? []);
  return flat;
}

function currentBookmark() {
  const tab = activeTab;
  if (!tab?.viewer) return null;
  const loc = tab.viewer.getLocation();
  return (tab.record.bookmarks ?? []).find((b) => sameLocation(b.location, loc)) ?? null;
}

function toggleBookmark() {
  const tab = activeTab;
  const viewer = tab?.viewer;
  if (!viewer) return;
  const existing = currentBookmark();
  tab.record.bookmarks ??= [];
  if (existing) {
    tab.record.bookmarks.splice(tab.record.bookmarks.indexOf(existing), 1);
    toast('Закладку прибрано');
  } else {
    const location = viewer.getLocation();
    const chapter = flatToc(viewer)[viewer.currentTocIndex?.() ?? -1]?.label ?? '';
    const progress = viewer.progress();
    let text;
    if (viewer.kind === 'fixed') {
      text = `Сторінка ${location.page + 1}`;
    } else {
      const snippet = viewer.snippet?.() ?? '';
      text = snippet.length > 90 ? `${snippet.slice(0, 90)}…` : snippet || progress.text;
    }
    tab.record.bookmarks.push({ location, chapter, text, percent: progress.value, created: Date.now() });
    tab.record.bookmarks.sort((a, b) => a.percent - b.percent);
    toast('Закладку додано');
  }
  saveStore();
  updateBookmarkButton();
  renderBookmarks();
}

function updateBookmarkButton() {
  const btn = document.getElementById('btn-bookmark');
  const on = !!currentBookmark();
  btn.classList.toggle('active', on);
  btn.title = on ? 'Прибрати закладку (Ctrl+D)' : 'Додати закладку (Ctrl+D)';
}

function renderBookmarks() {
  const tab = activeTab;
  const list = tab?.record.bookmarks ?? [];
  if (!list.length) {
    bookmarkList.replaceChildren(h('p', { class: 'panel-empty' }, 'Закладок ще немає. Натисніть ', icon('bookmark', 14), ' або Ctrl+D, щоб додати.'));
    return;
  }
  bookmarkList.replaceChildren(...list.map((bm) => {
    const remove = h('button', { class: 'icon-btn', title: 'Видалити закладку' }, icon('x', 14));
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      tab.record.bookmarks.splice(tab.record.bookmarks.indexOf(bm), 1);
      saveStore();
      renderBookmarks();
      updateBookmarkButton();
    });
    const item = h('div', { class: 'bookmark-item', role: 'button', tabindex: '0' },
      h('div', { class: 'bookmark-main' },
        h('div', { class: 'bookmark-text' }, bm.text),
        h('div', { class: 'bookmark-sub' }, [bm.chapter, `${Math.floor(bm.percent * 100)}%`].filter(Boolean).join(' · '))),
      remove);
    const open = () => tab.viewer?.goTo(bm.location);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (e) => e.key === 'Enter' && open());
    return item;
  }));
}

function showSidePanel(view) {
  sidePanelView = view;
  for (const b of document.querySelectorAll('.panel-tabs button')) b.classList.toggle('on', b.dataset.panel === view);
  els.tocList.hidden = view !== 'toc';
  bookmarkList.hidden = view !== 'bookmarks';
  if (view === 'bookmarks') renderBookmarks();
  else {
    highlightedToc = null;
    highlightToc();
  }
}

function setupBookmarks() {
  const btn = document.getElementById('btn-bookmark');
  btn.append(icon('bookmark'));
  btn.addEventListener('click', toggleBookmark);
  for (const b of document.querySelectorAll('.panel-tabs button')) {
    b.addEventListener('click', () => showSidePanel(b.dataset.panel));
  }
}

// Go to: a page number in PDF/DjVu, a percentage of the book in FB2/EPUB
function openGoto() {
  const viewer = activeTab?.viewer;
  if (!viewer || els.progress.querySelector('input')) return;
  const fixed = viewer.kind === 'fixed';
  const input = h('input', {
    class: 'goto-input',
    type: 'text',
    inputmode: 'numeric',
    'aria-label': fixed ? 'Перейти на сторінку' : 'Перейти до відсотка книги',
    placeholder: fixed ? `1–${viewer.pageCount}` : '0–100 %',
  });
  const close = () => {
    input.remove();
    updateProgress();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key !== 'Enter') return;
    const n = parseFloat(input.value.replace(',', '.'));
    if (Number.isFinite(n)) {
      if (fixed) viewer.goTo({ page: Math.min(Math.max(Math.round(n), 1), viewer.pageCount) - 1, f: 0 });
      else viewer.goToProgress(n / 100);
    }
    close();
  });
  input.addEventListener('blur', close);
  els.progress.replaceChildren(input);
  input.focus();
}

function toggleToc() {
  const viewer = activeTab?.viewer;
  if (!viewer) return;
  els.tocPanel.hidden = !els.tocPanel.hidden;
  // A book without a TOC shows bookmarks right away
  if (!els.tocPanel.hidden) showSidePanel(viewer.toc?.length ? sidePanelView : 'bookmarks');
  highlightedToc = null;
  highlightToc();
}

/* ------------------------------------------------------------------
 * Startup
 * ------------------------------------------------------------------ */

function setupToolbar() {
  const btn = (id, iconName) => document.getElementById(id).append(icon(iconName));
  btn('btn-new-tab', 'plus');
  btn('btn-toc', 'menu');
  btn('btn-zoom-out', 'zoomOut');
  btn('btn-zoom-in', 'zoomIn');
  btn('btn-settings', 'type');
  els.modeSwitch.querySelector('[data-mode="scroll"]').append(icon('scroll'));
  els.modeSwitch.querySelector('[data-mode="paged"]').append(icon('pages'));

  document.getElementById('btn-new-tab').addEventListener('click', openDialog);
  document.getElementById('btn-open-big').addEventListener('click', openDialog);
  document.getElementById('btn-toc').addEventListener('click', toggleToc);
  els.progress.addEventListener('click', openGoto);
  document.getElementById('btn-theme').addEventListener('click', () => {
    setTheme({ light: 'sepia', sepia: 'dark', dark: 'light' }[store.settings.theme]);
  });
  els.modeSwitch.addEventListener('click', (e) => {
    const mode = e.target.closest('button')?.dataset.mode;
    if (mode) setMode(mode);
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => activeTab?.viewer?.zoomIn?.());
  document.getElementById('btn-zoom-out').addEventListener('click', () => activeTab?.viewer?.zoomOut?.());
  els.zoomSelect.addEventListener('change', () => {
    const v = els.zoomSelect.value;
    if (v !== 'custom') activeTab?.viewer?.setZoom?.(isNaN(v) ? v : Number(v));
  });
}

async function init() {
  const saved = await api.loadState();
  Object.assign(store.settings, saved.settings);
  store.books = saved.books ?? {};
  Object.assign(store.reading, saved.reading);
  document.documentElement.dataset.theme = store.settings.theme;
  updateThemeButton();

  setupToolbar();
  setupKeyboard();
  setupDragAndDrop();
  setupSettingsPanel();
  setupSearch();
  setupBookmarks();
  setupLibrary();
  setupWheelZoom();
  api.onOpenFiles((files) => files.forEach((f, i) => openBook(f, { activate: i === files.length - 1 })));
  window.addEventListener('beforeunload', () => saveStore.flush());

  // Restore tabs from the previous session (only files that still exist)
  const session = saved.session ?? { tabs: [] };
  for (const path of session.tabs ?? []) {
    if (await api.bookExists(path)) openBook(path, { activate: false });
  }
  const active = tabs.find((t) => t.path === session.active);
  if (active) activateTab(active);

  const initial = await api.initialFiles();
  initial.forEach((f, i) => openBook(f, { activate: i === initial.length - 1 }));

  updateToolbar();
}

// Hooks for autotests (tools/autotest.js)
window.app = { openLibrary, closeLibrary, renderLibrary, exportData, importData, resetSettings, clearHistory, resetAll, uninstallApp, trackReadingSpeed, formatMinutes, toggleBookmark, showSidePanel, openSearch, closeSearch, openBook, closeTab, activateTab, setTheme, setMode, updateSettings, setSettingsOpen, DEFAULT_SETTINGS, tabs, store, get activeTab() { return activeTab; } };

init();
