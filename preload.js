// preload.js — GrapeNote v1.0.2

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  openAddDialog: () => ipcRenderer.invoke('open-add-dialog'),
  openEditDialog: (task) => ipcRenderer.invoke('open-edit-dialog', task),
  onRefreshTasks: (cb) => ipcRenderer.on('refresh-tasks', cb),
  exportCSV: (csv) => ipcRenderer.invoke('export-csv', csv),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  getConfigPath: () => ipcRenderer.invoke('get-config-path'),
  setConfigPath: () => ipcRenderer.invoke('set-config-path'),
  resetConfigPath: () => ipcRenderer.invoke('reset-config-path'),
  openConfigFolder: () => ipcRenderer.invoke('open-config-folder'),
  setAutoStart: (enable) => ipcRenderer.invoke('set-auto-start', enable),
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setWindowLock: (locked) => ipcRenderer.invoke('set-window-lock', locked),
  getWindowLock: () => ipcRenderer.invoke('get-window-lock'),
  getHwAccel: () => ipcRenderer.invoke('get-hw-accel'),
  setHwAccel: (enable) => ipcRenderer.invoke('set-hw-accel', enable)
});
