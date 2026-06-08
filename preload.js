'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Project store
  list: () => ipcRenderer.invoke('project:list'),
  get: (id) => ipcRenderer.invoke('project:get', id),
  save: (project) => ipcRenderer.invoke('project:save', project),
  remove: (id) => ipcRenderer.invoke('project:delete', id),

  // Generation + files
  preview: (project) => ipcRenderer.invoke('project:preview', project),
  attach: (projectId) => ipcRenderer.invoke('project:attach', projectId),
  exportProject: (project) => ipcRenderer.invoke('project:export', project),

  // App / updater
  appInfo: () => ipcRenderer.invoke('app:info'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),

  onUpdateStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  }
});
