const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { execFile } = require('node:child_process');
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
ipcMain.handle('malik-pos:open-bluetooth-settings', async () => { try { await shell.openExternal('ms-settings:bluetooth'); return { success: true }; } catch (error) { return { success: false, error: String(error && error.message || error) }; } });
ipcMain.handle('malik-pos:discover-bluetooth', async () => {
  if (process.platform !== 'win32') return { devices: [], ports: [], error: 'Bluetooth enumeration is currently supported on Windows only.' };
  const script = "$ErrorActionPreference='SilentlyContinue';$bt=@(Get-PnpDevice -Class Bluetooth | Select-Object @{n='name';e={$_.FriendlyName}},@{n='id';e={$_.InstanceId}},@{n='status';e={$_.Status}});$ports=@(Get-CimInstance Win32_SerialPort | Select-Object @{n='port';e={$_.DeviceID}},@{n='name';e={$_.Name}},@{n='id';e={$_.PNPDeviceID}});[PSCustomObject]@{devices=$bt;ports=$ports}|ConvertTo-Json -Depth 4 -Compress";
  return await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) return resolve({ devices: [], ports: [], error: String(stderr || error.message || 'Windows Bluetooth discovery failed').trim().slice(0, 300) });
    try { const data = JSON.parse(stdout.trim() || '{}'); const normalize = x => Array.isArray(x) ? x : x && typeof x === 'object' ? [x] : []; resolve({ devices: normalize(data.devices), ports: normalize(data.ports) }); }
    catch { resolve({ devices: [], ports: [], error: 'Windows returned an unreadable device list.' }); }
  }));
});
ipcMain.handle('malik-pos:print-escpos', async (_event, options = {}) => {
  const port = String(options.port || '').trim().toUpperCase();
  const baud = Number(options.baudRate) || 9600;
  if (!/^COM[1-9][0-9]*$/.test(port)) return { success: false, error: 'Enter a valid Windows serial port such as COM3.' };
  if (![9600, 19200, 38400, 57600, 115200].includes(baud)) return { success: false, error: 'Unsupported baud rate.' };
  const text = String(options.text || '').slice(0, 30000).replace(/[^\x20-\x7E\r\n\t]/g, '');
  if (!text.trim()) return { success: false, error: 'Receipt content is empty.' };
  const payload = Buffer.concat([Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0]), Buffer.from(text, 'ascii'), Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00])]).toString('base64');
  const script = "$ErrorActionPreference='Stop';$portName='" + port + "';$bytes=[Convert]::FromBase64String('" + payload + "');$serial=[System.IO.Ports.SerialPort]::new($portName," + baud + ",'None',8,'One');$serial.WriteTimeout=5000;$serial.Open();try{$serial.Write($bytes,0,$bytes.Length)}finally{$serial.Close()}";
  return await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => resolve(error ? { success: false, error: String(stderr || error.message || error).trim().slice(0, 500) } : { success: true })));
});
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
