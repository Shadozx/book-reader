'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readBook: (filePath) => ipcRenderer.invoke('book:read', filePath),
  bookExists: (filePath) => ipcRenderer.invoke('book:exists', filePath),
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  initialFiles: () => ipcRenderer.invoke('app:initial-files'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  info: (options) => ipcRenderer.invoke('dialog:info', options),
  resetAll: () => ipcRenderer.invoke('data:reset-all'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  exportData: (state) => ipcRenderer.invoke('data:export', state),
  backupInfo: () => ipcRenderer.invoke('data:backup-info'),
  openBackups: () => ipcRenderer.invoke('data:open-backups'),
  revealBook: (filePath) => ipcRenderer.invoke('book:reveal', filePath),
  locateBook: (oldPath) => ipcRenderer.invoke('book:locate', oldPath),
  importRead: () => ipcRenderer.invoke('data:import-read'),
  importApply: () => ipcRenderer.invoke('data:import-apply'),
  uninstallInfo: () => ipcRenderer.invoke('app:uninstall-info'),
  uninstall: () => ipcRenderer.invoke('app:uninstall'),
  setLanguage: (setting) => ipcRenderer.invoke('app:set-language', setting),
  appVersion: () => ipcRenderer.invoke('app:version'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  onOpenFiles: (callback) => ipcRenderer.on('open-files', (_e, files) => callback(files)),
});
