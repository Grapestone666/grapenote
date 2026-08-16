// main.js — GrapeNote v1.0.2 主进程

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

// ========== 数据文件路径 ==========
const DEFAULT_DATA_DIR = app.getPath('userData');
const POINTER_FILE = path.join(DEFAULT_DATA_DIR, 'config-path.txt');

function getDataFilePath() {
  try {
    if (fs.existsSync(POINTER_FILE)) {
      const p = fs.readFileSync(POINTER_FILE, 'utf-8').trim();
      if (p && fs.existsSync(path.dirname(p))) return p;
    }
  } catch (e) {}
  return path.join(DEFAULT_DATA_DIR, 'tasks-data.json');
}

// ========== 默认数据 ==========
const DEFAULT_DATA = {
  tasks: [], completedHistory: [],
  settings: {
    windowBounds: { x: 100, y: 100, width: 380, height: 600 },
    bgColor: '#000000', bgOpacity: 0.3, textColor: '#FFFFFF',
    fontFamily: "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif",
    fontSize: 13, cornerStyle: 'round', autoStart: false, windowLocked: false
  }
};

let mainWindow = null;
let tray = null;
let dialogWindow = null;     // 当前打开的对话框窗口
let dialogInitData = null;   // 传给对话框的初始数据
let hiddenByUser = false;

// ========== 数据读写 ==========

function loadData() {
  const f = getDataFilePath();
  try {
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
      return { tasks: data.tasks||[], completedHistory: data.completedHistory||[], settings: { ...DEFAULT_DATA.settings, ...data.settings } };
    }
  } catch (e) { console.error('读取数据失败:', e); }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData(data) {
  const f = getDataFilePath();
  try {
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error('保存数据失败:', e); }
}

// ========== 托盘图标 ==========

function createTrayIcon() {
  const s=16, c=Buffer.alloc(s*s*4,0);
  function f(x0,y0,w,h,r,g,b,a){for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){if(x>=0&&x<s&&y>=0&&y<s){const o=(y*s+x)*4;c[o]=r;c[o+1]=g;c[o+2]=b;c[o+3]=a;}}}
  f(2,2,12,13,0x40,0x9E,0xFF,0xFF); f(5,1,6,3,0x20,0x60,0xC0,0xFF); f(6,0,4,2,0x20,0x60,0xC0,0xFF);
  f(4,4,8,9,0xFF,0xFF,0xFF,0xFF); f(5,6,6,1,0x33,0x33,0x33,0xFF); f(5,8,5,1,0x33,0x33,0x33,0xFF); f(5,10,4,1,0x33,0x33,0x33,0xFF);
  return nativeImage.createFromBuffer(c,{width:s,height:s});
}

// ========== 桌面嵌入 ==========

function getHelperExePath() { return path.join(DEFAULT_DATA_DIR, 'embed-helper.exe'); }

function findCscExe() {
  const w = process.env.WINDIR || 'C:\\Windows';
  for (const d of [path.join(w,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'), path.join(w,'Microsoft.NET','Framework','v4.0.30319','csc.exe')]) {
    if (fs.existsSync(d)) return d;
  }
  return null;
}

function compileEmbedHelper() {
  const exe = getHelperExePath();
  try { if (fs.existsSync(exe)) fs.unlinkSync(exe); } catch(e) {}
  const csLocs = [path.join(__dirname, 'embed-helper.cs'), path.join(process.resourcesPath||'', 'embed-helper.cs')];
  let cs = null;
  for (const p of csLocs) { if (fs.existsSync(p)) { cs = p; break; } }
  if (!cs) { console.log('Embed: .cs not found'); return null; }
  const csc = findCscExe();
  if (!csc) { console.log('Embed: csc.exe not found'); return null; }
  try {
    execSync(`"${csc}" /nologo /optimize /out:"${exe}" "${cs}"`, { windowsHide: true, timeout: 30000 });
    return exe;
  } catch (e) { console.error('Embed: compile failed:', e.message); return null; }
}

function embedWindowInDesktop() {
  if (process.platform !== 'win32' || !mainWindow) return false;
  try {
    const buf = mainWindow.getNativeWindowHandle();
    const hwnd = buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
    const exe = compileEmbedHelper();
    if (!exe) return false;
    const result = execSync(`"${exe}" embed ${hwnd}`, { encoding: 'utf-8', timeout: 10000, windowsHide: true }).trim();
    console.log('Embed:', result);
    if (result.startsWith('OK')) {
      const b = ensureBoundsVisible(loadBoundsForCurrentDisplays());
      mainWindow.setBounds(b);
      return true;
    }
    return false;
  } catch (e) { console.error('Embed error:', e.message); return false; }
}

// ========== 任务对话框窗口 ==========

function openTaskDialog(mode, task) {
  if (dialogWindow) { dialogWindow.focus(); return; }

  // 计算对话框位置（主窗口旁边）
  let x = 200, y = 200;
  if (mainWindow) {
    const mb = mainWindow.getBounds();
    x = mb.x + Math.round(mb.width / 2) - 170;
    y = mb.y + 60;
  }

  dialogInitData = { mode: mode, task: task || null };

  dialogWindow = new BrowserWindow({
    x, y, width: 340, height: mode === 'edit' ? 380 : 360,
    minWidth: 280, minHeight: 300,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'dialog-preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false
    }
  });

  dialogWindow.loadFile('task-dialog.html');
  dialogWindow.once('closed', () => { dialogWindow = null; dialogInitData = null; });
}

// 对话框 IPC
ipcMain.on('dialog-get-init-data', (event) => {
  event.returnValue = dialogInitData || { mode: 'add', task: null };
});

ipcMain.on('dialog-submit', (event, formData) => {
  const data = loadData();
  const initMode = dialogInitData ? dialogInitData.mode : 'add';
  const initTask = dialogInitData ? dialogInitData.task : null;

  if (initMode === 'edit' && initTask) {
    // 编辑模式：更新已有任务
    const task = data.tasks.find(t => t.id === initTask.id);
    if (task) {
      task.title = formData.title;
      task.notes = formData.notes;
      task.deadline = formData.deadline;
      task.recurring = formData.recurring;
    }
  } else {
    // 添加模式
    data.tasks.push({
      id: genId(), title: formData.title, notes: formData.notes,
      deadline: formData.deadline, completed: false, completedAt: null,
      createdAt: new Date().toISOString(), recurring: formData.recurring
    });
  }
  saveData(data);
  // 通知主窗口刷新
  if (mainWindow) mainWindow.webContents.send('refresh-tasks');
  if (dialogWindow) dialogWindow.close();
});

ipcMain.on('dialog-delete', () => {
  if (dialogInitData && dialogInitData.task) {
    const data = loadData();
    data.tasks = data.tasks.filter(t => t.id !== dialogInitData.task.id);
    saveData(data);
    if (mainWindow) mainWindow.webContents.send('refresh-tasks');
  }
  if (dialogWindow) dialogWindow.close();
});

ipcMain.on('dialog-cancel', () => {
  if (dialogWindow) dialogWindow.close();
});

function genId() { return 'xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random()*16|0).toString(16)); }

// ========== 多分辨率位置记忆 ==========
// 用所有显示器的分辨率组合生成一个 key，每种显示器配置各自记住窗口位置

function getDisplayKey() {
  const displays = screen.getAllDisplays()
    .map(d => `${d.bounds.width}x${d.bounds.height}`)
    .sort()
    .join('+');
  return displays; // 例如 "1920x1080+2560x1440"
}

/** 根据当前显示器配置，取出对应的窗口位置 */
function loadBoundsForCurrentDisplays() {
  const data = loadData();
  const key = getDisplayKey();
  const saved = (data.settings.displayBounds || {})[key];
  if (saved) return saved;
  // 没有当前配置的记录，用默认位置
  return data.settings.windowBounds;
}

/** 保存窗口位置到当前显示器配置的 key 下 */
function saveBoundsForCurrentDisplays(bounds) {
  const data = loadData();
  const key = getDisplayKey();
  if (!data.settings.displayBounds) data.settings.displayBounds = {};
  data.settings.displayBounds[key] = bounds;
  data.settings.windowBounds = bounds; // 同时更新默认位置
  saveData(data);
}

/** 确保位置在某个屏幕内，否则归位到主屏 */
function ensureBoundsVisible(bounds) {
  const displays = screen.getAllDisplays();
  const cx = bounds.x + Math.round(bounds.width / 2);
  const cy = bounds.y + Math.round(bounds.height / 2);
  for (const d of displays) {
    const a = d.workArea;
    if (cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) return bounds;
  }
  const p = screen.getPrimaryDisplay().workArea;
  return { x: p.x + p.width - bounds.width - 20, y: p.y + 40, width: bounds.width, height: bounds.height };
}

// ========== 创建主窗口 ==========

function createWindow() {
  const data = loadData();
  const b = ensureBoundsVisible(loadBoundsForCurrentDisplays());

  mainWindow = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    minWidth: 140, minHeight: 200,
    title: 'GrapeNote',
    frame: false, transparent: true, skipTaskbar: true,
    resizable: true, show: false, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (data.settings.windowLocked) {
      mainWindow.setResizable(false);
      mainWindow.setMovable(false);
    }
    const ok = embedWindowInDesktop();
    if (!ok) {
      console.log('Embed failed, using fallback');
      mainWindow.on('minimize', () => {
        setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.restore(); mainWindow.show(); } }, 200);
      });
    }
  });

  mainWindow.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); hiddenByUser = true; mainWindow.hide(); } });
  mainWindow.on('moved', saveWindowBounds);
  mainWindow.on('resized', saveWindowBounds);

  setInterval(() => {
    if (!hiddenByUser && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);
}

function saveWindowBounds() {
  if (!mainWindow) return;
  saveBoundsForCurrentDisplays(mainWindow.getBounds());
}

// ========== 系统托盘 ==========

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('GrapeNote');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { hiddenByUser = false; if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: '隐藏窗口', click: () => { hiddenByUser = true; if (mainWindow) mainWindow.hide(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { hiddenByUser = false; if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

// ========== IPC ==========

ipcMain.handle('get-data', () => loadData());
ipcMain.handle('save-data', (_, data) => { saveData(data); return true; });

// 打开添加/编辑对话框
ipcMain.handle('open-add-dialog', () => { openTaskDialog('add', null); return true; });
ipcMain.handle('open-edit-dialog', (_, task) => { openTaskDialog('edit', task); return true; });

// 导出 CSV
ipcMain.handle('export-csv', async (_, csv) => {
  const r = await dialog.showSaveDialog(mainWindow, { title: '导出', defaultPath: `GrapeNote_${new Date().toISOString().slice(0,10)}.csv`, filters: [{name:'CSV',extensions:['csv']}] });
  if (!r.canceled && r.filePath) { try { fs.writeFileSync(r.filePath, '\uFEFF'+csv, 'utf-8'); return {success:true}; } catch(e) { return {success:false}; } }
  return {success:false};
});

ipcMain.handle('export-config', async () => {
  const r = await dialog.showSaveDialog(mainWindow, { title: '导出配置', defaultPath: `GrapeNote_backup_${new Date().toISOString().slice(0,10)}.json`, filters: [{name:'JSON',extensions:['json']}] });
  if (!r.canceled && r.filePath) { try { fs.writeFileSync(r.filePath, JSON.stringify(loadData(),null,2), 'utf-8'); return {success:true}; } catch(e) { return {success:false}; } }
  return {success:false};
});

ipcMain.handle('import-config', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: '导入配置', filters: [{name:'JSON',extensions:['json']}], properties: ['openFile'] });
  if (!r.canceled && r.filePaths.length > 0) {
    try { const d = JSON.parse(fs.readFileSync(r.filePaths[0],'utf-8')); if (d.tasks && d.settings) { saveData(d); return {success:true}; } } catch(e) {}
  }
  return {success:false};
});

ipcMain.handle('get-config-path', () => getDataFilePath());
ipcMain.handle('set-config-path', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: '选择配置文件', filters: [{name:'JSON',extensions:['json']}], properties: ['openFile','promptToCreate'] });
  if (!r.canceled && r.filePaths.length > 0) {
    const p = r.filePaths[0];
    try {
      if (!fs.existsSync(p)) { const dir=path.dirname(p); if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(p,JSON.stringify(loadData(),null,2),'utf-8'); }
      fs.writeFileSync(POINTER_FILE, p, 'utf-8');
      return {success:true, path:p};
    } catch(e) { return {success:false}; }
  }
  return {success:false};
});

ipcMain.handle('reset-config-path', () => {
  try { if (fs.existsSync(POINTER_FILE)) fs.unlinkSync(POINTER_FILE); return {success:true, path:path.join(DEFAULT_DATA_DIR,'tasks-data.json')}; } catch(e) { return {success:false}; }
});

ipcMain.handle('open-config-folder', () => { shell.showItemInFolder(getDataFilePath()); return true; });

ipcMain.handle('set-window-lock', (_, locked) => {
  if (!mainWindow) return false;
  mainWindow.setResizable(!locked); mainWindow.setMovable(!locked);
  const data = loadData(); data.settings.windowLocked = locked; saveData(data);
  return locked;
});
ipcMain.handle('get-window-lock', () => !!loadData().settings.windowLocked);

ipcMain.handle('set-auto-start', (_, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable, path: process.execPath });
  const data = loadData(); data.settings.autoStart = enable; saveData(data);
  return enable;
});
ipcMain.handle('get-auto-start', () => app.getLoginItemSettings().openAtLogin);

// 硬件加速开关
ipcMain.handle('get-hw-accel', () => {
  const data = loadData();
  return data.settings.hwAccel !== false; // 默认开启
});

ipcMain.handle('set-hw-accel', (_, enable) => {
  const data = loadData();
  data.settings.hwAccel = enable;
  saveData(data);
  // 需要重启才能生效
  return enable;
});

// ========== 应用生命周期 ==========

// 在 app.whenReady 之前检查硬件加速设置
try {
  const initData = loadData();
  if (initData.settings.hwAccel === false) {
    app.disableHardwareAcceleration();
    console.log('Hardware acceleration: DISABLED');
  }
} catch (e) {}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // 监听显示器变化（外接/断开时加载对应配置的位置）
  function onDisplayChange() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const saved = ensureBoundsVisible(loadBoundsForCurrentDisplays());
    mainWindow.setBounds(saved);
  }
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);
});
app.on('window-all-closed', () => {});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); }
else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }); }
