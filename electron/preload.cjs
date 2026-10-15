const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('malikPOS', Object.freeze({
  listPrinters: () => ipcRenderer.invoke('malik-pos:list-printers'),
  print: (options) => ipcRenderer.invoke('malik-pos:print', options || {})
}));
