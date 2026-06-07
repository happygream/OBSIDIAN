const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer } = require('./server');

// Must register protocol scheme BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

let autoUpdater = null;
if (app.isPackaged) {
  try { autoUpdater = require('electron-updater').autoUpdater; } catch {}
}

Menu.setApplicationMenu(null);
app.on('browser-window-created', (_, win) => win.setMenuBarVisibility(false));

let mainWindow;
const serverPort = 9001;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#060408',
    title: '0BS1D14N',
    frame: false,
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  // Register asset:// protocol handler — serves files from app root
  protocol.handle('asset', (request) => {
    const filePath = path.join(__dirname, request.url.slice('asset://'.length));
    return net.fetch('file:///' + filePath.replace(/\\/g, '/'));
  });

  await startServer(serverPort);
  createWindow();
  setupUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

// ---- Auto-updater ----
function setupUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdaterStatus('Checking for updates...'));
  autoUpdater.on('update-available',    (i) => sendUpdaterStatus('Update available: v' + i.version + ' — downloading...'));
  autoUpdater.on('update-not-available',()  => sendUpdaterStatus('Up to date — v' + app.getVersion()));
  autoUpdater.on('download-progress',   (p) => sendUpdaterStatus('Downloading update: ' + Math.round(p.percent) + '%'));
  autoUpdater.on('update-downloaded',   (i) => {
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: '0BS1D14N — Update Ready',
      message: 'v' + i.version + ' downloaded.',
      detail: 'Restart now to apply, or it installs on next launch.',
      buttons: ['Restart Now', 'Later'], defaultId: 0,
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.on('error', (e) => sendUpdaterStatus('Update failed: ' + e.message));
  autoUpdater.checkForUpdatesAndNotify();
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
}

function sendUpdaterStatus(text) {
  if (mainWindow) mainWindow.webContents.send('updater-status', text);
}

// ---- IPC handlers ----
ipcMain.handle('pick-file', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-port',        ()              => serverPort);
ipcMain.handle('get-audio-path',  ()              => 'file:///' + path.join(__dirname, 'assets', 'audio', 'theme.mp3').replace(/\\/g, '/'));
ipcMain.handle('get-version',     ()              => app.getVersion());
ipcMain.handle('read-file',       (_, p)          => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } });

ipcMain.handle('load-plugins', async () => {
  const pluginDir = path.join(__dirname, 'plugins');
  try {
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir);
    const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));
    return files.map(file => {
      try {
        delete require.cache[require.resolve(path.join(pluginDir, file))];
        const p = require(path.join(pluginDir, file));
        return { id: p.id || file, name: p.name || file, desc: p.desc || '', tag: p.tag || 'custom', binary: p.binary || p.id || file };
      } catch (e) { return { id: file, name: file, desc: 'Error: ' + e.message, tag: 'error' }; }
    });
  } catch { return []; }
});

ipcMain.handle('screenshot', async () => {
  if (!mainWindow) return { success: false };
  try {
    const image = await mainWindow.webContents.capturePage();
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'obsidian-screenshot-' + new Date().toISOString().replace(/[:.]/g,'-').slice(0,19) + '.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (canceled || !filePath) return { success: false };
    fs.writeFileSync(filePath, image.toPNG());
    return { success: true, filePath };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('win-minimize',    ()              => mainWindow?.minimize());
ipcMain.handle('win-maximize',    ()              => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
ipcMain.handle('win-close',       ()              => mainWindow?.close());
ipcMain.handle('win-is-maximized',()              => mainWindow?.isMaximized() ?? false);

ipcMain.handle('save-file', async (_, { defaultName, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'HTML',         extensions: ['html'] },
      { name: 'Markdown',     extensions: ['md']   },
      { name: 'Shell Script', extensions: ['sh']   },
    ],
  });
  if (canceled || !filePath) return { success: false };
  try { fs.writeFileSync(filePath, content, 'utf8'); return { success: true, filePath }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('check-update', () => {
  if (autoUpdater && app.isPackaged) autoUpdater.checkForUpdatesAndNotify();
  return app.getVersion();
});
