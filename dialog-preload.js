// dialog-preload.js — 任务对话框的预加载脚本

const { contextBridge, ipcRenderer } = require('electron');

// 从主进程接收初始数据（同步）
let initData = { mode: 'add', task: null };

// 主进程在创建窗口时通过 additionalArguments 传递数据不方便，
// 改用 IPC 同步请求
try {
  initData = ipcRenderer.sendSync('dialog-get-init-data');
} catch (e) {}

contextBridge.exposeInMainWorld('dialogAPI', {
  getInitData: () => initData,
  submit: (data) => ipcRenderer.send('dialog-submit', data),
  deleteTask: () => ipcRenderer.send('dialog-delete'),
  cancel: () => ipcRenderer.send('dialog-cancel')
});
