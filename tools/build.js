'use strict';
// Installer build: npm run dist  →  dist/Chytalka-Setup-<version>.exe
// All downloads (Electron, NSIS) are cached in the project folder, not globally.

const path = require('node:path');

const root = path.resolve(__dirname, '..');
process.env.electron_config_cache ??= path.join(root, '.electron-cache');
process.env.ELECTRON_BUILDER_CACHE ??= path.join(root, '.builder-cache');

const { build } = require('electron-builder');

build({ projectDir: root, win: ['nsis'], publish: 'never' })
  .then((files) => {
    console.log('\nГотово:');
    for (const file of files) console.log('  ' + path.relative(root, file));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
