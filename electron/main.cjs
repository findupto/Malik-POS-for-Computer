const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const isDev = !app.isPackaged;
function createWindow() {
  const win = new BrowserWindow({
    width: 1480, height: 960, minWidth: 1000, minHeight: 680,
    backgroundColor: '#f6f8fb', autoHideMenuBar: true,
    title: 'Malik POS',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
