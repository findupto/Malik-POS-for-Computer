const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('malikPOS', Object.freeze({
  listPrinters: () => ipcRenderer.invoke('malik-pos:list-printers'),
  openPrinterSettings: () => ipcRenderer.invoke('malik-pos:open-printer-settings'),
  printEscpos: (options) => ipcRenderer.invoke('malik-pos:print-escpos', options || {}),
  print: (options) => ipcRenderer.invoke('malik-pos:print', options || {})
}));
