const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow;
let appServer;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function startAppServer() {
  const distDirectory = path.resolve(__dirname, '..', 'dist');

  appServer = http.createServer(async (request, response) => {
    let filePath;

    try {
      const requestPath = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
      filePath = path.resolve(distDirectory, relativePath);

      if (!filePath.startsWith(`${distDirectory}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      const contents = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(contents);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        response.writeHead(404).end('Not found');
        return;
      }

      console.error(`Failed to serve desktop app file ${filePath || request.url}:`, error);
      response.writeHead(500).end('Internal server error');
    }
  });

  return new Promise((resolve, reject) => {
    appServer.once('error', reject);
    appServer.listen(0, '127.0.0.1', () => {
      const address = appServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine the desktop app server address.'));
        return;
      }

      // Firebase Auth authorizes localhost; keep the server bound to this machine only.
      resolve(`http://localhost:${address.port}/`);
    });
  });
}

function createWindow(appUrl) {
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

  void mainWindow.loadURL(appUrl).catch((error) => {
    console.error('Failed to load desktop app:', error);
    dialog.showErrorBox('App failed to start', error.message);
  });
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

app.whenReady().then(async () => {
  let appUrl;
  try {
    appUrl = await startAppServer();
  } catch (error) {
    console.error('Failed to start desktop app server:', error);
    dialog.showErrorBox('App failed to start', error.message);
    app.quit();
    return;
  }

  createWindow(appUrl);

  if (app.isPackaged) {
    void autoUpdater.checkForUpdates().catch((error) => {
      console.error('Automatic update check could not start:', error);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(appUrl);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  appServer?.close();
});
