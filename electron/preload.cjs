const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('malikPOS', Object.freeze({
  listPrinters: () => ipcRenderer.invoke('malik-pos:list-printers'),
  openPrinterSettings: () => ipcRenderer.invoke('malik-pos:open-printer-settings'),
  openBluetoothSettings: () => ipcRenderer.invoke('malik-pos:open-bluetooth-settings'),
  discoverBluetooth: () => ipcRenderer.invoke('malik-pos:discover-bluetooth'),
  printEscpos: (options) => ipcRenderer.invoke('malik-pos:print-escpos', options || {}),
  print: (options) => ipcRenderer.invoke('malik-pos:print', options || {}),
  printHtml: (options) => ipcRenderer.invoke('malik-pos:print-html', options || {}),
  saveBackupSnapshot: (snapshot) => ipcRenderer.invoke('malik-pos:save-backup-snapshot', snapshot || {}),
  openBackupFolder: () => ipcRenderer.invoke('malik-pos:open-backup-folder'),
  selectBackupFile: () => ipcRenderer.invoke('malik-pos:select-backup-file'),
  connectGoogleDrive: (clientId) => ipcRenderer.invoke('malik-pos:connect-google-drive', clientId),
  googleDriveStatus: () => ipcRenderer.invoke('malik-pos:google-drive-status'),
  disconnectGoogleDrive: () => ipcRenderer.invoke('malik-pos:disconnect-google-drive'),
  chooseCloudFolder: () => ipcRenderer.invoke('malik-pos:choose-cloud-folder'),
  cloudFolderStatus: () => ipcRenderer.invoke('malik-pos:cloud-folder-status'),
  openCloudFolder: () => ipcRenderer.invoke('malik-pos:open-cloud-folder'),
  disconnectCloudFolder: () => ipcRenderer.invoke('malik-pos:disconnect-cloud-folder')
}));
