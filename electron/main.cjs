const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    void dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update available',
      message: `Version ${info.version} is available and will download automatically.`
    });
  }
});

autoUpdater.on('update-downloaded', async (info) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update ready',
    message: `Version ${info.version} has been downloaded.`,
    detail: 'Restart the app to install the update.',
    buttons: ['Restart and install', 'Later'],
    defaultId: 0,
    cancelId: 1
  });

  if (result.response === 0) {
    autoUpdater.quitAndInstall();
  }
});

autoUpdater.on('error', (error) => {
  console.error('Automatic update failed:', error);
  if (mainWindow) {
    void dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Update check failed',
      message: 'The app could not check for updates.',
      detail: error.message
    });
  }
});

app.whenReady().then(() => {
  createWindow();

  if (app.isPackaged) {
    void autoUpdater.checkForUpdates().catch((error) => {
      console.error('Automatic update check could not start:', error);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
