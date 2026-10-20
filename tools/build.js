'use strict';
// Installer build: npm run dist  →  dist/Chytalka-Setup-<version>.exe
// All downloads (Electron, NSIS) are cached in the project folder, not globally.

const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
process.env.electron_config_cache ??= path.join(root, '.electron-cache');
process.env.ELECTRON_BUILDER_CACHE ??= path.join(root, '.builder-cache');

const { build } = require('electron-builder');

// The Ukrainian installer texts need two fixes that electron-builder has no option for, so for the
// duration of the build some files are edited in place and restored afterwards (even if the build fails):
//  1. electron-builder's own texts (installation mode page, upgrade notes…) have no Ukrainian translation:
//     the translations from build/installer-uk.json are added to its message templates;
//  2. the Ukrainian translation bundled with NSIS 3.0.4 has typos ("Программа", "процессу"…)
//     and a few inconsistencies ("каталог" next to "тека", a missing full stop).

const builderDir = path.dirname(require.resolve('app-builder-lib/package.json'));
const TEMPLATES = ['messages.yml', 'assistedMessages.yml'].map((name) => path.join(builderDir, 'templates', 'nsis', name));

const NSIS_TYPOS = [
  ['Программ', 'Програм'],
  ['программ', 'програм'],
  ['процесс', 'процес'],
  ['вказанн', 'вказан'],
  ['видаленно', 'видалено'],
  ['Переіменування', 'Перейменування'],
  ['перезаванаження', 'перезавантаження'],
  ['встновлення', 'встановлення'],
  ['Підтверждення', 'Підтвердження'],
  ['Натисніть Видалить', 'Натисніть Видалити'],
  ['Встановлення перервана', 'Встановлення перервано'],
  ['Каталог призначення', 'Тека призначення'],
  ['з вказаного каталогу', 'з вказаної теки'],
  // "Click Install / Uninstall to start…" has no full stop (applied after the typo fixes above)
  [/(для початку процесу (?:встановлення|видалення))(?=\r?$)/gm, '$1.'],
];

const originals = new Map();
function edit(file, change) {
  const text = fs.readFileSync(file, 'utf8');
  const changed = change(text);
  if (changed === text) return;
  if (!originals.has(file)) originals.set(file, text);
  fs.writeFileSync(file, changed);
}
function restoreAll() {
  for (const [file, text] of originals) fs.writeFileSync(file, text);
}

function addUkrainianMessages() {
  const translations = JSON.parse(fs.readFileSync(path.join(root, 'build', 'installer-uk.json'), 'utf8'));
  const unused = new Set(Object.keys(translations));
  for (const file of TEMPLATES) {
    // A message is "id:" followed by indented "  lang: text" lines; add "  uk:" where it's missing
    edit(file, (text) => text.replace(/^(\w+):\r?\n((?: {2}.*\r?\n)*)/gm, (block, id, body) => {
      if (!(id in translations)) return block;
      unused.delete(id);
      if (/^ {2}uk:/m.test(body)) return block;
      // A JSON string is a valid YAML double-quoted scalar
      return `${block}  uk: ${JSON.stringify(translations[id])}\n`;
    }));
  }
  if (unused.size) console.warn('installer-uk.json: unknown message ids:', [...unused].join(', '));
}

async function fixNsisUkrainian() {
  // Internal electron-builder API (the version is pinned in package.json); it downloads NSIS if needed
  const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
  const { env } = await getMakeNsisPath();
  const dir = path.join(env.NSISDIR, 'Contrib', 'Language files');
  const unused = new Set(NSIS_TYPOS.map(([from]) => from));
  for (const name of ['Ukrainian.nlf', 'Ukrainian.nsh']) {
    edit(path.join(dir, name), (text) => NSIS_TYPOS.reduce((t, [from, to]) => {
      const found = typeof from === 'string' ? t.includes(from) : t.search(from) >= 0;
      if (found) unused.delete(from);
      return t.replaceAll(from, to);
    }, text));
  }
  if (unused.size) console.warn('NSIS Ukrainian: typos not found (already fixed upstream?):', [...unused].join(', '));
}

async function main() {
  let failed = false;
  try {
    addUkrainianMessages();
    await fixNsisUkrainian();
    const files = await build({ projectDir: root, win: ['nsis'], publish: 'never' });
    console.log('\nDone:');
    for (const file of files) console.log('  ' + path.relative(root, file));
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    restoreAll();
  }
  // An explicit exit: a failed build must not end with code 0
  if (failed) process.exit(1);
}

main();
