'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Harness store
  list: () => ipcRenderer.invoke('harness:list'),
  get: (id) => ipcRenderer.invoke('harness:get', id),
  save: (harness) => ipcRenderer.invoke('harness:save', harness),
  remove: (id) => ipcRenderer.invoke('harness:delete', id),
  run: (harness) => ipcRenderer.invoke('harness:run', harness),

  // App / updater
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),

  // Streaming events
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('harness:progress', handler);
    return () => ipcRenderer.removeListener('harness:progress', handler);
  },
  onUpdateStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  }
});
