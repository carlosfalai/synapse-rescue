const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('synapseAPI', {
  scanProfiles: () => ipcRenderer.invoke('scan-profiles'),
  readProfile: (filePath) => ipcRenderer.invoke('read-profile', filePath),
  convertProfile: (opts) => ipcRenderer.invoke('convert-profile', opts),
  exportProfile: (opts) => ipcRenderer.invoke('export-profile', opts),
  backupAll: (paths) => ipcRenderer.invoke('backup-all', paths),
  importProfile: () => ipcRenderer.invoke('import-profile'),
  openInExplorer: (filePath) => ipcRenderer.invoke('open-in-explorer', filePath),
  getScanPaths: () => ipcRenderer.invoke('get-scan-paths'),
  checkRazerInstalled: () => ipcRenderer.invoke('check-razer-installed'),
});
