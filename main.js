'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const { buildSkillMd, buildSystemDesign, buildHtml, slugify } = require('./src/harness/generator');
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

  // DevTools는 명시적으로 --dev 로 실행할 때만 연다 (npm run dev).
  // 그냥 npm start 에서는 열지 않아 Autofill/Failed to fetch 같은 DevTools 잡음이 안 나온다.
  if (process.argv.includes('--dev')) {
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
// IPC: project CRUD
// ---------------------------------------------------------------------------
ipcMain.handle('project:list', () => store.list());
ipcMain.handle('project:get', (_e, id) => store.get(id));
ipcMain.handle('project:save', (_e, project) => store.save(project));
ipcMain.handle('project:delete', (_e, id) => store.remove(id));

// Generate preview (no disk write)
ipcMain.handle('project:preview', (_e, project) => ({
  skill: buildSkillMd(project),
  design: buildSystemDesign(project),
  html: buildHtml(project)
}));

// Attach a file via dialog -> copies into the project's attachment store
ipcMain.handle('project:attach', async (_e, projectId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '첨부할 파일 선택',
    properties: ['openFile', 'multiSelections']
  });
  if (canceled) return [];
  return filePaths.map((fp) => store.addAttachment(projectId, fp));
});

// Export: writes a skill package folder + design doc to a user-chosen directory
ipcMain.handle('project:export', async (_e, project) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '내보낼 폴더 선택',
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true };

  const outRoot = filePaths[0];
  const skillName = slugify(project.skillName || project.name);
  const outs = Array.isArray(project.outputs) ? project.outputs : ['skill', 'design'];
  const written = [];

  if (outs.includes('skill')) {
    const skillDir = path.join(outRoot, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillFile, buildSkillMd(project), 'utf8');
    written.push(skillFile);

    const atts = Array.isArray(project.attachments) ? project.attachments : [];
    if (atts.length) {
      const resDir = path.join(skillDir, 'resources');
      fs.mkdirSync(resDir, { recursive: true });
      for (const a of atts) {
        try {
          fs.copyFileSync(store.attachmentAbsPath(a), path.join(resDir, a.name));
        } catch {
          /* skip missing */
        }
      }
    }
  }

  if (outs.includes('design')) {
    const designFile = path.join(outRoot, `${skillName}-SYSTEM_DESIGN.md`);
    fs.writeFileSync(designFile, buildSystemDesign(project), 'utf8');
    written.push(designFile);
  }

  if (outs.includes('html')) {
    const htmlFile = path.join(outRoot, `${skillName}.html`);
    fs.writeFileSync(htmlFile, buildHtml(project), 'utf8');
    written.push(htmlFile);
  }

  shell.openPath(outRoot);
  return { ok: true, outRoot, written };
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
