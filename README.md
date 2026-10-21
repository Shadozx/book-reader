# Chytalka

A Windows desktop app for reading **FB2, EPUB, PDF and DjVu** books.
Built with Electron (HTML/CSS/JavaScript). *Chytalka* (Читалка) is Ukrainian for "reader";
the app is called Chytalka in every interface language.

## Features

- **Interface language:** English or Ukrainian. By default it follows Windows (the first language in the system language list). Switches in the app panel (the gear button) without a restart.
- **Tabs:** several books open at once; tabs are restored after a restart.
- **Two reading modes:** continuous scrolling or page by page (a two-page spread on a wide screen).
- **Themes:** light, sepia, dark. In the dark theme PDF/DjVu pages are inverted (light text on a dark background), while covers and photos keep their natural look.
- **Brightness:** dims the book area from 100% down to 30% for reading at night; tabs and panels stay as they are.
- **Two settings panels:** reading settings under the "T" button on the toolbar (theme, brightness, mode, text, pages) and the app panel under the gear button at the right of the tab bar (language, data, uninstall; available even with no book open).
- **Text settings (FB2/EPUB):** font, size, line spacing, margins, column width, paragraph indent, paragraph spacing, alignment.
- **Zoom (PDF/DjVu):** "Auto", "Fit width", "Fit page" or a percentage.
- **Reading position** is remembered for every book and survives changes of font, window size or mode.
- **Current chapter:** below the book title you see which chapter you are in, how much of it you've read and how much time is left until its end; a thin bar under the toolbar shows the chapter progress. The time is based on your reading speed: it starts with a typical one (≈1100 characters per minute or ≈1.4 min per scanned page) and then adapts to you; jumps through the contents, going back and breaks are ignored.
- **Table of contents**, **bookmarks**, **text search**, **go to** a page or a percentage.
- **Highlights (FB2/EPUB):** select a phrase with the mouse and pick one of four colours in the popup over it; a click on a highlight changes its colour, copies or deletes it. Highlights are tied to the text, not to the screen, so they stay in place when the font, mode or window size changes, and are found again if the book file is edited.
- **Footnotes** in FB2/EPUB open in a popup.
- **Text selection and copying** in PDF and DjVu (if the file has a text layer).

## Requirements

- Windows 10 or 11 (64-bit).
- [Node.js](https://nodejs.org/), 22 LTS recommended. Node.js 20 works too, but Electron officially asks for 22.12+.

All dependencies are installed **locally** into the project folder; nothing is installed globally.

## Running

```bash
npm install
```

```bash
npm start
```

`npm install` installs the dependencies into `node_modules` and downloads Electron.
To keep Electron's download cache in the project folder as well (instead of `%LOCALAPPDATA%\electron\Cache`),
set an environment variable before installing (PowerShell):

```powershell
$env:electron_config_cache = "$PWD\.electron-cache"; npm install
```

Open a book with the "+" button, Ctrl+O, or by dropping a file into the window.

## Building the installer

```bash
npm run dist
```

The result is `dist\Chytalka-Setup-<version>.exe` (about 120 MB). It also creates
`dist\win-unpacked\`, the app without installation (`Chytalka.exe`).

- The build is done by [electron-builder](https://www.electron.build/); its settings are in the `build` field of `package.json`.
- `tools/build.js` sends all downloads (Electron, NSIS) to the project folders `.electron-cache` and `.builder-cache`. The first build downloads the tools and takes a few minutes, later ones take 1–2 minutes.
- The installer lets you choose the installation folder, installs for the current user only (no administrator rights needed), creates "Chytalka" shortcuts on the desktop and in the Start menu, and registers the app for `.fb2`, `.epub`, `.pdf`, `.djvu`, `.djv`.
- The installer is in English or Ukrainian, depending on the Windows display language. electron-builder has no Ukrainian translation for some of its pages and NSIS's Ukrainian texts contain typos, so `tools/build.js` adds the translations from `build/installer-uk.json` and fixes the typos for the duration of the build (the files are restored afterwards).
- The app icon is `build/icon.png`; it is drawn by a script and can be redrawn with `npm run icon`.

Installation notes:

- **The installer is not code-signed**, so Windows SmartScreen will show "Windows protected your PC" → "More info" → "Run anyway".
- **PDF:** if a default PDF app is already chosen (Edge, Acrobat), Windows doesn't let the installer change it. The app appears in the "Open with" menu, where you can choose "Always".

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Open a book | Ctrl+O |
| Close the tab | Ctrl+W (or the middle mouse button on a tab) |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PageDown / Ctrl+PageUp |
| Tab by number | Ctrl+1 … Ctrl+9 |
| Contents and bookmarks | Ctrl+B |
| Library | Ctrl+L |
| Search | Ctrl+F; Enter / Shift+Enter or F3 / Shift+F3 for the next / previous match; Esc to close |
| Go to a page (PDF/DjVu) or a percentage (FB2/EPUB) | Ctrl+G or a click on the page counter |
| Add / remove a bookmark | Ctrl+D |
| Font size (FB2/EPUB) or zoom (PDF/DjVu) | Ctrl + "+" / Ctrl + "−", Ctrl + mouse wheel; Ctrl+0 for the default |
| Brightness | Ctrl+Shift+↑ / Ctrl+Shift+↓ (10% steps) |
| Turn pages | → ← PageDown PageUp, Space / Shift+Space, mouse wheel, a click on the left or right edge of the page |
| Start / end of the book | Home / End |
| Full screen | F11 |
| Developer tools | F12 |

## Where the data is stored

Settings, open tabs, reading positions and bookmarks are kept in
`%APPDATA%\book-reader\state.json` (shared by `npm start` and the installed app).
The books themselves are never copied: the app only reads them from disk.

### Resetting data

The app panel (the gear button at the right of the tab bar) → the **"Data"** section:

| Button | What it does |
|---|---|
| Reset settings | theme, font, spacing, mode, brightness, language → defaults; books, bookmarks and reading positions stay |
| Clear reading history… | after confirmation closes the tabs and deletes the list of recent books, reading positions and bookmarks |
| Reset everything and restart… | after confirmation deletes `state.json` and reloads the app from a clean state (including the measured reading speed) |
| Export data… | saves a backup (settings, books with reading positions, bookmarks, tabs, reading speed) to `chytalka-backup-<date>.json`, by default in `Documents\Chytalka` |
| Import data… | restores data from a backup: shows when it was created and how many books and bookmarks it has, and after confirmation replaces the current data and restarts the app |
| Automatic daily backup | on by default (see below) |
| Open the backups folder | opens `Documents\Chytalka` in Explorer |
| Open the data folder | opens `%APPDATA%\book-reader` in Explorer |

None of these actions touch the book files.

Import accepts both an export file and a plain `state.json`; foreign or damaged files are rejected.
Window size and position are not exported, since they depend on the monitor.
A backup stores only the paths to the books: if the book files were moved, the library marks them
"file not found", and the "Find file…" button moves their data to the new location.

### Automatic backups

The app keeps its working data in `%APPDATA%\book-reader` and writes backups on its own to
**`Documents\Chytalka`**, where they survive both "Reset everything" and uninstalling the app:

- one file per day, `chytalka-auto-<date>.json`; during the day it is updated at most once every 5 minutes;
- the last 10 days are kept, older auto backups are deleted; manual exports (`chytalka-backup-…`) are left alone;
- if the reading history is empty (for example right after "Reset everything"), no backup is written, so the previous one isn't overwritten;
- can be turned off with a switch in the "Data" section;
- to restore, use "Import data…" and pick the file;
- backups from the old folder `Documents\Читалка` (earlier versions) are moved to `Chytalka` automatically.

## Library

The button at the left of the tab bar or **Ctrl+L** lists every book the app remembers:

- a summary: how many books, how many have a reading position, how many bookmarks and how many files are missing;
- for each book: format, title and author, file path, progress, when it was last opened, number of bookmarks,
  and "open" or "file not found" marks;
- actions: **Open** (the book opens at the saved position; a double click works too), **Show in folder**,
  **Find file…** (if the book was moved, its reading position and bookmarks move to the new path), **Forget**;
- search by title, author or path, and sorting: recent, by title, by progress.

The welcome screen has a "Whole library" link under "Recent".

## Uninstalling

Either way works:

- The app panel (the gear button) → **"Uninstall the app…"**: the app closes and the standard uninstaller starts.
- **Windows Settings → Apps → Installed apps → "Chytalka" → Uninstall.**

The uninstaller asks whether to also delete the settings, bookmarks and reading positions (`%APPDATA%\book-reader`).
Answer "No" to keep them, so everything comes back after reinstalling. When updating the app
(installing a new version over the old one) the question isn't asked and the data isn't deleted.
The uninstaller step is defined in `build/installer.nsh`.

The version started with `npm start` isn't installed in the system; to remove it, just delete the project folder
(and, if you like, `%APPDATA%\book-reader`).

## Project structure

```
book-reader/
├─ package.json            dependencies, scripts, build settings
├─ build/
│  ├─ icon.png             app icon
│  └─ installer.nsh        extra uninstaller steps
├─ vendor/djvu.js          DjVu.js: DjVu table of contents and fallback decoder
├─ samples/                optional real books for the tests (not in the repository)
├─ src/
│  ├─ main/                Electron main process
│  │  ├─ main.js           window, file reading, dialogs, state saving, app:// protocol
│  │  ├─ i18n.js           translations for native dialogs
│  │  └─ preload.js        safe bridge between the window and the system
│  └─ renderer/            user interface
│     ├─ index.html, styles.css
│     ├─ app.js            tabs, toolbar, search, bookmarks, library, hotkeys
│     ├─ settings-panel.js reading settings ("T" button) and the app panel (gear button)
│     ├─ i18n.js           interface translations
│     ├─ locales/          interface texts: en.json, uk.json
│     ├─ lib.js            on-demand library loading
│     ├─ formats/          format parsers
│     │  ├─ fb2.js, epub.js         → book model for the text viewer
│     │  ├─ pdf.js, djvu.js         → "page sources" for the page viewer
│     │  └─ djvu-worker.js          DjVu decoding (djvu-rs) in a background thread
│     └─ viewers/
│        ├─ flow.js        FB2/EPUB: scroll and paged modes, location, footnotes, search
│        └─ fixed.js       PDF/DjVu: pages, zoom, text layer, links, search
└─ tools/
   ├─ build.js             installer build
   ├─ make-icon.js         icon drawing
   ├─ run-tests.js         npm test: runs the scenarios and prints a summary
   ├─ autotest.js          runs one scenario in the app (window, screenshots, results)
   ├─ test-kit/            helpers for the scenarios, one file per topic
   ├─ test-books.json      the books the tests use, by role
   ├─ make-fixtures.js     npm run fixtures: generates the test books
   ├─ fixtures/            generated test books
   └─ scenarios/           autotest scenarios
```

### Translations

All interface texts live in `src/renderer/locales/en.json` and `uk.json` with the same keys;
the main process uses the same files for native dialogs. To add a language, add a `<code>.json`
with all the keys and register it in `src/renderer/i18n.js` and `src/main/i18n.js`.
The `language` autotest checks that the dictionaries have the same keys and placeholders.

## Autotests

```bash
npm test
```

runs every scenario in `tools/scenarios/` one after another and prints a summary; the exit code is 1
if anything failed. Each scenario starts the app with its own temporary data folder (your settings
and backups are not touched), performs actions the way a user does and checks the result.
Logs and screenshots go to `test-results/<scenario>/`. The app's window works out of sight
(off the screen, without a taskbar button, without taking the focus), so you can keep working
while the tests run; set `AUTOTEST_VISIBLE=1` to watch it instead.

```bash
npm test -- epub reading-settings
```

runs only the named scenarios, and `npm test -- --lang en` runs them with the English interface
(the expected texts come from `en.json` / `uk.json`, not from the tests).

### Test books

The books the tests use are listed by role in `tools/test-books.json`:

- **generated books** in `tools/fixtures/` (FB2, EPUB 2 and 3, PDF): made by `npm run fixtures`
  from our own word lists, so they have no copyright and are part of the repository;
  `tools/fixtures/facts.json` records what they contain (chapters, footnotes, how often the search word occurs);
- **optional real books** in `samples/` (not in the repository): DjVu, which can't be generated without
  DjVuLibre, and a scanned PDF. Checks that need a missing one are reported as skipped.
  `CHYTALKA_SAMPLES_DIR` points to another folder with these books.

Some older scenarios still open the books in `samples/` directly; they are being moved to the test kit.

### Writing scenarios

A scenario reads as a list of small named steps made of user actions and checks:

```js
module.exports = [
  // First run
  async ({ step, reader, bookmarks, check }) => {
    await step('Ctrl+D adds a bookmark here', async () => {
      await reader.open('fb2');
      await reader.goToContentsItem(8);
      await bookmarks.toggle();
      check('one bookmark', (await bookmarks.count()) === 1);
    });
  },
  // After a restart: the window was closed the way a user closes it, and the app started again
  async ({ step, bookmarks, check }) => { … },
];
module.exports.title = 'Bookmarks in a text book and in a PDF, and after a restart';
```

The helpers live in `tools/test-kit/`, one file per topic, each listing its functions at the top:
`reader` (open a book, position, contents, pages, mode), `sidePanel`, `bookmarks`,
`readingSettings` and `appPanel`. The code that runs inside the window stays in these helpers,
so a change in the app's markup is fixed in one place. Every action writes itself to the log
(`→ press Ctrl+D`), and `npm test` prints each step with its actions and checks.
A step that throws counts as one failed check; the rest of the scenario still runs.

The core helpers (`tools/test-kit/index.js`) are `step(name, fn)`, `check(name, ok, detail)`,
`skip(reason)`, `act(text)`, `book(role)`, `has(role)`, `facts`, `t(key, params)` and `press(key, modifiers)`;
`exec` runs code in the window, `waitFor`, `wait`, `shot` and `resize` are there too.
Exporting an array of steps makes the app close and start again between them (restart checks).

Every scenario starts with no saved data, so scenarios don't depend on each other and run in any order.
`module.exports.packaged = true` tests the built app (`npm run dist` first).
A single scenario can also be started directly (its first step; `--step=N` runs another one):

```bash
npx electron tools/autotest.js tools/scenarios/epub.scenario.js test-results/epub
```

| Scenario | What it checks |
|---|---|
| `tabs-themes` | a tab for every format, themes; tabs, active tab and theme after a restart |
| `fb2`, `fb2-edge` | FB2: parsing, images, contents, footnotes; damaged files, windows-1251, `.fb2.zip` |
| `epub`, `formatting` | EPUB 2 and 3: parsing, contents, footnotes, unsafe markup; italic, bold, links |
| `pdf-djvu`, `djvu-quick`, `dark-pages` | PDF and DjVu: drawing, contents, text layer, spreads, zoom, speed, dark theme |
| `reading-modes` | scroll and paged modes, keeping the position across mode, window and font changes and a restart |
| `reading-settings` | the reading settings panel and the font size hotkeys |
| `resize` | text and images fit windows of different sizes |
| `search`, `bookmarks`, `chapter`, `toc-jump` | search, bookmarks (also after a restart), current chapter, jumping through the contents |
| `highlights-anchors` | finding a highlight again after the book text changed (moved, duplicated, edited, deleted) |
| `highlights-basic`, `highlights-epub` | highlighting with a real mouse drag, changing the colour, copying, deleting, Esc; the same in EPUB |
| `highlights-restart` | highlights in different colours after the app is closed and started again |
| `highlights-overlap` | a highlight over part of another one is painted on top and gets the clicks; deleting it shows the one under it again |
| `highlights-layout` | a highlight stays on its words, visible and clickable, after a bigger font, wider line spacing, pages side by side, a narrow window, turning pages and scrolling again |
| `reading-time` | time to the end of the chapter, reading speed adaptation |
| `close-tabs` | closing tabs of every format (close button, middle button, Ctrl+W) with real mouse clicks |
| `data` | the app panel, reset settings, clear history, "Reset everything", the uninstall button in the dev version |
| `backup` | data export and import, restoring after "Reset everything", rejecting foreign files |
| `library` | library (search, sorting, "Find file…", "Forget"), automatic backups and their rotation |
| `language` | switching the language without a restart, no Ukrainian text in the English UI, matching keys in `en.json` and `uk.json` |
| `brightness` | brightness slider and hotkeys, 30–100% limits, only the book area is dimmed |
| `packaged` | the built app opens every format from `app.asar` |

The tests write backups to a test folder instead of the real Documents (`CHYTALKA_BACKUP_DIR`)
and set the "system language" to the test language (`CHYTALKA_SYSTEM_LANG`), so the results don't depend on the machine.

## Libraries and licenses

| Library | Used for | License |
|---|---|---|
| [Electron](https://www.electronjs.org/) | app shell | MIT |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | PDF | Apache-2.0 |
| [JSZip](https://stuk.github.io/jszip/) | EPUB, `.fb2.zip` | MIT or GPL-3.0 (your choice) |
| [djvu-rs](https://github.com/matyushkin/djvu-rs) | DjVu rendering, text layer | MIT |
| [DjVu.js](https://djvu.js.org/) (`vendor/djvu.js`) | DjVu table of contents, fallback decoder | GPL-2.0 or later |

DjVu.js is distributed under GPL-2.0 (or any later version). This doesn't matter for personal use; if the app
is ever distributed as closed source, DjVu.js will have to be replaced.
