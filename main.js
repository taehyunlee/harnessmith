'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const { runHarness } = require('./src/harness/runner');
const store = require('./src/harness/store');

const isDev = process.argv.includes('--dev') || !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'Harness Forge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Open external links in the default browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// ---------------------------------------------------------------------------
// Auto-update (GitHub Releases via electron-updater)
// ---------------------------------------------------------------------------
function setupAutoUpdate() {
  if (isDev) {
    log('updater', 'dev 모드 — 자동 업데이트 비활성화');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendStatus('checking', '업데이트 확인 중…'));
  autoUpdater.on('update-available', (info) =>
    sendStatus('available', `새 버전 발견: v${info.version} (다운로드 중)`)
  );
  autoUpdater.on('update-not-available', () => sendStatus('latest', '최신 버전입니다'));
  autoUpdater.on('error', (err) => sendStatus('error', `업데이트 오류: ${err == null ? '' : err.message}`));
  autoUpdater.on('download-progress', (p) =>
    sendStatus('downloading', `다운로드 ${Math.round(p.percent)}%`)
  );
  autoUpdater.on('update-downloaded', async (info) => {
    sendStatus('downloaded', `v${info.version} 다운로드 완료`);
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      title: '업데이트 준비됨',
      message: `새 버전 v${info.version} 이(가) 다운로드되었습니다.`,
      detail: '지금 재시작하면 업데이트가 적용됩니다.'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdatesAndNotify().catch((e) =>
    sendStatus('error', `업데이트 확인 실패: ${e.message}`)
  );
}

function sendStatus(state, message) {
  log('updater', `${state} — ${message}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { state, message });
  }
}

function log(scope, msg) {
  // eslint-disable-next-line no-console
  console.log(`[${scope}] ${msg}`);
}

// ---------------------------------------------------------------------------
// IPC: harness CRUD + run
// ---------------------------------------------------------------------------
ipcMain.handle('harness:list', () => store.list());
ipcMain.handle('harness:get', (_e, id) => store.get(id));
ipcMain.handle('harness:save', (_e, harness) => store.save(harness));
ipcMain.handle('harness:delete', (_e, id) => store.remove(id));

ipcMain.handle('harness:run', async (_e, harness) => {
  return runHarness(harness, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('harness:progress', event);
    }
  });
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  dataDir: store.dataDir()
}));

ipcMain.handle('app:openDataDir', () => shell.openPath(store.dataDir()));

ipcMain.handle('app:checkUpdate', () => {
  if (isDev) return { ok: false, message: 'dev 모드에서는 사용할 수 없습니다' };
  autoUpdater.checkForUpdatesAndNotify();
  return { ok: true };
});

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  createWindow();
  setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
