const { app, BrowserWindow, shell, ipcMain, dialog, Notification, safeStorage } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
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


const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const driveConfigPath = () => path.join(app.getPath('userData'), 'google-drive.enc');
function readDriveConfig() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = require('node:fs').readFileSync(driveConfigPath());
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch { return null; }
}
function saveDriveConfig(config) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure Windows credential storage is unavailable.');
  const temp = driveConfigPath() + '.tmp';
  require('node:fs').writeFileSync(temp, safeStorage.encryptString(JSON.stringify(config)), { mode: 0o600 });
  require('node:fs').renameSync(temp, driveConfigPath());
}
async function connectGoogleDrive(clientId) {
  if (typeof clientId !== 'string' || !/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId.trim())) throw new Error('Enter a valid Google OAuth Desktop client ID from Google Cloud Console.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this computer.');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(24).toString('hex');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const redirectUri = 'http://127.0.0.1:' + address.port + '/oauth2callback';
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [key, value] of Object.entries({ client_id: clientId.trim(), redirect_uri: redirectUri, response_type: 'code', scope: DRIVE_SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' })) authUrl.searchParams.set(key, value);
  const callback = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.close(); reject(new Error('Google authorization timed out. Please try again.')); }, 5 * 60 * 1000);
    server.on('request', (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
      if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Authorization state mismatch. You can close this window.'); clearTimeout(timeout); server.close(); reject(new Error('Google authorization state validation failed.')); return; }
      const code = url.searchParams.get('code');
      if (!code) { const error = url.searchParams.get('error') || 'Google authorization was cancelled.'; res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Authorization not completed. You can close this window.'); clearTimeout(timeout); server.close(); reject(new Error(error)); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end('<!doctype html><meta charset="utf-8"><title>Malik POS</title><p>Google Drive connected. You can return to Malik POS.</p>');
      clearTimeout(timeout); server.close(); resolve(code);
    });
  });
  try {
    await shell.openExternal(authUrl.toString());
    const code = await callback;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId.trim(), code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.refresh_token) throw new Error(token.error_description || token.error || 'Google did not return a refresh token. Disconnect the app in Google Account permissions and try again.');
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { authorization: 'Bearer ' + token.access_token } });
    const user = userResponse.ok ? await userResponse.json() : {};
    saveDriveConfig({ clientId: clientId.trim(), refreshToken: token.refresh_token, email: user.email || '', connectedAt: new Date().toISOString(), uploadedDay: '' });
    return { success: true, email: user.email || '' };
  } catch (error) { server.close(); throw error; }
}
async function driveAccessToken(config) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, refresh_token: config.refreshToken, grant_type: 'refresh_token' }) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Google Drive authorization expired. Reconnect your account.');
  return data.access_token;
}
async function uploadBackupToDrive(file, day) {
  const config = readDriveConfig();
  if (!config?.refreshToken) return { success: false, connected: false, error: 'Google Drive is not connected.' };
  if (config.uploadedDay === day) return { success: true, skipped: true };
  const accessToken = await driveAccessToken(config);
  const query = encodeURIComponent("name = 'Malik POS Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const folderResponse = await fetch('https://www.googleapis.com/drive/v3/files?q=' + query + '&fields=files(id,name)&pageSize=10', { headers: { authorization: 'Bearer ' + accessToken } });
  if (!folderResponse.ok) throw new Error('Could not check Google Drive backup folder (' + folderResponse.status + ').');
  const folderData = await folderResponse.json();
  let folderId = folderData.files?.[0]?.id;
  if (!folderId) {
    const createFolder = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Malik POS Backups', mimeType: 'application/vnd.google-apps.folder' }) });
    const folder = await createFolder.json();
    if (!createFolder.ok || !folder.id) throw new Error('Could not create Google Drive backup folder.');
    folderId = folder.id;
  }
  const bytes = await fs.readFile(file);
  const boundary = 'malikpos_' + crypto.randomBytes(18).toString('hex');
  const metadata = JSON.stringify({ name: 'malik-pos-' + day + '.json', mimeType: 'application/json', parents: [folderId] });
  const body = Buffer.concat([Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n'), bytes, Buffer.from('\r\n--' + boundary + '--')]);
  const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size', { method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'multipart/related; boundary=' + boundary }, body });
  const uploaded = await upload.json();
  if (!upload.ok || !uploaded.id) throw new Error('Google Drive upload failed (' + upload.status + '): ' + (uploaded.error?.message || 'unknown error'));
  saveDriveConfig({ ...config, uploadedDay: day, lastUploadAt: new Date().toISOString() });
  return { success: true, fileId: uploaded.id, name: uploaded.name };
}
ipcMain.handle('malik-pos:connect-google-drive', async (_event, clientId) => {
  try { return await connectGoogleDrive(clientId); }
  catch (error) { return { success: false, error: String(error?.message || error).slice(0, 240) }; }
});
ipcMain.handle('malik-pos:google-drive-status', async () => {
  const config = readDriveConfig();
  return { connected: Boolean(config?.refreshToken), email: config?.email || '', lastUploadAt: config?.lastUploadAt || '' };
});
ipcMain.handle('malik-pos:disconnect-google-drive', async () => {
  try { const config = readDriveConfig(); if (config?.refreshToken) await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(config.refreshToken), { method: 'POST' }).catch(() => {}); await fs.unlink(driveConfigPath()).catch(() => {}); return { success: true }; }
  catch (error) { return { success: false, error: String(error?.message || error).slice(0, 200) }; }
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
  let cloud = { connected: false };
  try { cloud = await uploadBackupToDrive(file, day); }
  catch (error) { console.error('Malik POS Google Drive backup failed:', error); cloud = { success: false, connected: true, error: String(error?.message || error).slice(0, 240) }; }
  return { success: true, file, day, bytes: Buffer.byteLength(payload), cloud };
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
  let reminderDay = '';
  const runBackupSchedule = async () => {
    if (!latestBackupSnapshot) return;
    const today = new Date().toISOString().slice(0, 10);
    const config = readDriveConfig();
    if (!config?.refreshToken && reminderDay !== today && Notification.isSupported()) {
      reminderDay = today;
      const notice = new Notification({ title: 'Malik POS backup reminder', body: 'Connect Google Drive in Settings to keep an off-device backup.' });
      notice.show();
      setTimeout(() => notice.close(), 1000);
    }
    const result = await writeDailyBackup(latestBackupSnapshot);
    if (result.success && result.cloud?.success === false && result.cloud?.connected && Notification.isSupported()) {
      const notice = new Notification({ title: 'Malik POS backup failed', body: 'Google Drive backup failed. Open Malik POS Settings to reconnect and retry.' });
      notice.show(); setTimeout(() => notice.close(), 1000);
    }
  };
  backupScheduleTimer = setInterval(() => { runBackupSchedule().catch(error => console.error('Scheduled Malik POS backup failed:', error)); }, 60 * 60 * 1000);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
