const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('native', {
  drives: () => ipcRenderer.invoke('drives'),
  scan: root => ipcRenderer.invoke('scan', root),
  cancel: () => ipcRenderer.invoke('cancel'),
  trash: p => ipcRenderer.invoke('trash', p),
  relaunchAdmin: () => ipcRenderer.invoke('relaunchAdmin'),
  cancelRemove: () => ipcRenderer.invoke('cancelRemove'),
  remove: p => ipcRenderer.invoke('remove', p),
  drivers: () => ipcRenderer.invoke('drivers'),
  driverRemove: pub => ipcRenderer.invoke('driverRemove', pub),
  reveal: p => ipcRenderer.invoke('reveal', p),
  onProgress: cb => ipcRenderer.on('scan:p', (_e, s) => cb(s)),
});
