const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
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
  if (options.rasterBase64) {
    const widthBytes = Number(options.rasterWidthBytes);
    const height = Number(options.rasterHeight);
    if (!Number.isInteger(widthBytes) || widthBytes < 1 || widthBytes > 100 || !Number.isInteger(height) || height < 1 || height > 12000) return { success: false, error: 'Invalid receipt image dimensions.' };
    let raster;
    try { raster = Buffer.from(String(options.rasterBase64), 'base64'); } catch { return { success: false, error: 'Receipt image data is invalid.' }; }
    if (raster.length !== widthBytes * height || raster.length > 1200000) return { success: false, error: 'Receipt image is too large or incomplete.' };
    const xL = widthBytes & 0xff, xH = (widthBytes >> 8) & 0xff, yL = height & 0xff, yH = (height >> 8) & 0xff;
    const header = Buffer.from([0x1b,0x40,0x1b,0x61,0x00,0x1d,0x76,0x30,0x00,xL,xH,yL,yH]);
    const payload = Buffer.concat([header,raster,Buffer.from([0x0a,0x0a,0x1d,0x56,0x00])]);
    const payloadFile = path.join(app.getPath('temp'), 'malik-pos-print-' + process.pid + '-' + Date.now() + '.bin');
    try { await fs.writeFile(payloadFile, payload); } catch (error) { return { success:false, error:'Could not prepare receipt data: ' + String(error && error.message || error).slice(0,180) }; }
    const safeFile = payloadFile.replace(/'/g, "''");
    const script = "$ErrorActionPreference='Stop';$portName='" + port + "';$bytes=[System.IO.File]::ReadAllBytes('" + safeFile + "');$serial=[System.IO.Ports.SerialPort]::new($portName," + baud + ",'None',8,'One');$serial.WriteTimeout=10000;$serial.Open();try{for($i=0;$i -lt $bytes.Length;$i+=2048){$count=[Math]::Min(2048,$bytes.Length-$i);$serial.Write($bytes,$i,$count)}}finally{$serial.Close()}";
    return await new Promise(resolve => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { windowsHide:true, timeout:180000, maxBuffer:4096 }, async (error,stdout,stderr) => { try { await fs.unlink(payloadFile); } catch {} resolve(error ? { success:false, error:(String(stderr||error.message||error).split(/\r?\n/).find(line=>/timed out|access denied|cannot open|exception calling/i.test(line))||'Image printing failed. Check the selected outgoing COM port and printer compatibility.').trim().slice(0,240) } : { success:true }); }));
  }
  const text = String(options.text || '').slice(0, 30000);
  if (!text.replace(/\[[A-Z_]+\]/g, '').trim()) return { success: false, error: 'Receipt content is empty.' };
  // Render only known formatting tokens into ESC/POS commands; all receipt data remains plain printable ASCII.
  const commands = {
    '[CENTER]': [0x1b, 0x61, 0x01],
    '[LEFT]': [0x1b, 0x61, 0x00],
    '[RIGHT]': [0x1b, 0x61, 0x02],
    '[BOLD_ON]': [0x1b, 0x45, 0x01],
    '[BOLD_OFF]': [0x1b, 0x45, 0x00],
    '[DOUBLE_ON]': [0x1d, 0x21, 0x11],
    '[DOUBLE_OFF]': [0x1d, 0x21, 0x00],
    '[TALL_ON]': [0x1d, 0x21, 0x01],
    '[TALL_OFF]': [0x1d, 0x21, 0x00]
  };
  const chunks = text.split(/(\[(?:CENTER|LEFT|RIGHT|BOLD_ON|BOLD_OFF|DOUBLE_ON|DOUBLE_OFF|TALL_ON|TALL_OFF)\])/g);
  const buffers = [Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x00])];
  for (const chunk of chunks) {
    if (commands[chunk]) buffers.push(Buffer.from(commands[chunk]));
    else {
      const safe = chunk.replace(/[^\x20-\x7E\r\n\t]/g, '');
      if (safe) buffers.push(Buffer.from(safe, 'ascii'));
    }
  }
  buffers.push(Buffer.from([0x0a, 0x1d, 0x56, 0x00]));
  const payload = Buffer.concat(buffers);
  const payloadFile = path.join(app.getPath('temp'), 'malik-pos-print-' + process.pid + '-' + Date.now() + '.bin');
  try { await fs.writeFile(payloadFile, payload); } catch (error) { return { success:false, error:'Could not prepare receipt data: ' + String(error && error.message || error).slice(0,180) }; }
  const safeFile = payloadFile.replace(/'/g, "''");
  const script = "$ErrorActionPreference='Stop';$portName='" + port + "';$bytes=[System.IO.File]::ReadAllBytes('" + safeFile + "');$serial=[System.IO.Ports.SerialPort]::new($portName," + baud + ",'None',8,'One');$serial.WriteTimeout=2000;$serial.Open();try{$serial.Write($bytes,0,$bytes.Length)}finally{$serial.Close()}";
  return await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 8000, maxBuffer: 4096 }, async (error, stdout, stderr) => { try { await fs.unlink(payloadFile); } catch {} resolve(error ? { success: false, error: (String(stderr || error.message || error).split(/\r?\n/).find(line => /timed out|access denied|cannot open|exception calling/i.test(line)) || 'Printer connection timed out. Check the selected outgoing COM port, ensure no other app is using it, and verify the printer is awake and paired.').trim().slice(0, 240) } : { success: true }); }));
});
ipcMain.handle('malik-pos:print-html', async (event, options = {}) => {
  const { BrowserWindow } = require('electron');
  if (typeof options.html !== 'string' || !options.html.includes('<body>')) return { success: false, error: 'Receipt HTML is missing' };
  const width = options.pageSize === '58mm' ? 58000 : 80000;
  const height = Math.max(45000, Math.min(300000, Number(options.pageHeightMicrons) || 180000));
  const printWin = new BrowserWindow({ show: false, width: Math.round(width / 264.583), height: 1200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(options.html));
    await new Promise(resolve => setTimeout(resolve, 250));
    return await new Promise(resolve => printWin.webContents.print({
      silent: options.silent === true, printBackground: true,
      deviceName: typeof options.deviceName === 'string' && options.deviceName ? options.deviceName : undefined,
      pageSize: { width, height }
    }, (success, failureReason) => resolve({ success, error: failureReason || '' })));
  } catch (error) { return { success: false, error: error?.message || 'Receipt print failed' }; }
  finally { if (!printWin.isDestroyed()) printWin.close(); }
});
ipcMain.handle('malik-pos:print', async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { success: false, error: 'Window not available' };
  return new Promise(resolve => win.webContents.print({
    silent: options.silent === true,
    printBackground: true,
    deviceName: typeof options.deviceName === 'string' && options.deviceName ? options.deviceName : undefined,
    pageSize: options.pageSize === '58mm' ? { width: 58000, height: Math.max(45000, Math.min(300000, Number(options.pageHeightMicrons) || 100000)) } : options.pageSize === '80mm' ? { width: 80000, height: Math.max(45000, Math.min(300000, Number(options.pageHeightMicrons) || 100000)) } : undefined
  }, (success, failureReason) => resolve({ success, error: failureReason || '' })));
});

const BACKUP_RETENTION_DAYS = 30;
let latestBackupSnapshot = null;
let backupScheduleTimer = null;
function backupDirectory() { return path.join(app.getPath('userData'), 'backups'); }
async function writeDailyBackup(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.entries) || !snapshot.entries.length) return { success: false, error: 'No POS data snapshot is available yet.' };
  const dir = backupDirectory();
  await fs.mkdir(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, 'malik-pos-' + day + '.json');
  const payload = JSON.stringify({ format: 'malik-pos-local-backup-v1', createdAt: new Date().toISOString(), snapshotAt: snapshot.snapshotAt, entries: snapshot.entries }, null, 2);
  const temp = file + '.tmp';
  await fs.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, file);
  const names = (await fs.readdir(dir)).filter(name => /^malik-pos-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
  await Promise.all(names.slice(BACKUP_RETENTION_DAYS).map(name => fs.unlink(path.join(dir, name)).catch(() => {})));
  return { success: true, file, day, bytes: Buffer.byteLength(payload) };
}
ipcMain.handle('malik-pos:save-backup-snapshot', async (_event, snapshot) => {
  try {
    if (!snapshot || !Array.isArray(snapshot.entries) || snapshot.entries.length > 500) return { success: false, error: 'Invalid backup snapshot.' };
    const entries = snapshot.entries.filter(entry => entry && typeof entry.key === 'string' && entry.key.startsWith('malik-') && typeof entry.value === 'string' && !/session|token|password|credential|secret/i.test(entry.key));
    const safeSnapshot = { snapshotAt: new Date().toISOString(), entries };
    if (Buffer.byteLength(JSON.stringify(safeSnapshot)) > 25 * 1024 * 1024) return { success: false, error: 'Backup snapshot exceeds the 25 MB safety limit.' };
    latestBackupSnapshot = safeSnapshot;
    const dir = backupDirectory();
    await fs.mkdir(dir, { recursive: true });
    const latestTemp = path.join(dir, 'latest.json.tmp');
    await fs.writeFile(latestTemp, JSON.stringify({ format: 'malik-pos-local-backup-v1', ...safeSnapshot }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(latestTemp, path.join(dir, 'latest.json'));
    return await writeDailyBackup(safeSnapshot);
  } catch (error) {
    console.error('Malik POS backup failed:', error);
    return { success: false, error: String(error && error.message || error).slice(0, 240) };
  }
});
ipcMain.handle('malik-pos:open-backup-folder', async () => {
  try {
    const dir = backupDirectory();
    await fs.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    return error ? { success: false, error } : { success: true, path: dir };
  } catch (error) { return { success: false, error: String(error && error.message || error).slice(0, 240) }; }
});

app.whenReady().then(() => {
  backupScheduleTimer = setInterval(() => {
    if (latestBackupSnapshot) writeDailyBackup(latestBackupSnapshot).catch(error => console.error('Scheduled Malik POS backup failed:', error));
  }, 60 * 60 * 1000);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
