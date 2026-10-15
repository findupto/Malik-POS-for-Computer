const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const isDev = !app.isPackaged;
function createWindow() {
  const win = new BrowserWindow({
    width: 1480, height: 960, minWidth: 1000, minHeight: 680,
    backgroundColor: '#f6f8fb', autoHideMenuBar: true,
    title: 'Malik POS',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('Malik POS failed to load:', { errorCode, errorDescription, validatedURL });
    dialog.showMessageBox(win, { type: 'error', title: 'Malik POS could not start', message: 'Malik POS could not load its interface.', detail: 'Error ' + errorCode + ': ' + errorDescription + '\n\nLocation: ' + validatedURL + '\n\nPlease install the latest verified Windows installer.' });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Malik POS renderer stopped:', details);
    dialog.showMessageBox(win, { type: 'error', title: 'Malik POS stopped unexpectedly', message: 'The POS interface stopped unexpectedly.', detail: 'Reason: ' + details.reason + '\nExit code: ' + details.exitCode });
  });
  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html')).catch(error => {
    console.error('Could not load packaged Malik POS HTML:', error);
    dialog.showMessageBox({ type: 'error', title: 'Malik POS startup error', message: 'The installed interface files could not be found.', detail: String(error && (error.stack || error)) });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}
ipcMain.handle('malik-pos:list-printers', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault, status: p.status }));
});
ipcMain.handle('malik-pos:open-printer-settings', async () => { try { await shell.openExternal('ms-settings:printers'); return { success: true }; } catch (error) { return { success: false, error: String(error && error.message || error) }; } });
ipcMain.handle('malik-pos:print', async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { success: false, error: 'Window not available' };
  return new Promise(resolve => win.webContents.print({
    silent: options.silent === true,
    printBackground: true,
    deviceName: typeof options.deviceName === 'string' && options.deviceName ? options.deviceName : undefined,
    pageSize: options.pageSize === '58mm' ? { width: 58000, height: 200000 } : options.pageSize === '80mm' ? { width: 80000, height: 200000 } : undefined
  }, (success, failureReason) => resolve({ success, error: failureReason || '' })));
});
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
