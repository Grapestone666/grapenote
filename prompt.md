# GrapeNote v1.1.2 完整技术规范

## 项目概述

**GrapeNote** 是一个 Windows 桌面小部件任务管理应用，采用 Electron 框架和 C# Win32 API 相结合的双进程架构。应用以透明毛玻璃浮窗形式显示在 Windows 桌面上（类似便签），支持任务列表展示、快速添加/编辑、循环任务、完成历史和高度可定制的主题系统。

**基本信息：**
- 名称：GrapeNote
- 版本：v1.1.2
- 作者：Grape
- 许可证：MIT
- 主框架：Electron 31.0.0+
- 构建工具：electron-builder 24.13.3+
- 平台：Windows 7 SP1+（推荐 Win10/Win11）

---

## 核心架构

### 1. 应用多窗口设计

#### 为什么分离架构

在 Windows 桌面嵌入场景中，当 Electron 主窗口通过 Win32 API `SetParent()` 挂接到 WorkerW/Progman 时：
- 窗口获得 `WS_CHILD` 样式，失去焦点管理能力
- 键盘事件无法被主窗口捕获（包括文本输入框 focus）
- 用户无法在任务对话框中输入文本

**解决方案：两个独立的 BrowserWindow**

1. **主窗口** (`index.html` + `app.js`)
   - 职责：显示任务列表（只读视图）
   - 交互：仅支持鼠标操作（点击复选框、右键菜单）
   - 嵌入目标：桌面（WorkerW/Progman）
   - 不接收键盘输入

2. **对话框窗口** (`task-dialog.html`)
   - 职责：添加/编辑任务的表单界面
   - 交互：完整键盘支持（Enter/Escape 快捷键）
   - 生命周期：用户添加/编辑时打开，提交/取消时关闭
   - 属性：`skipTaskbar: true`、`alwaysOnTop: true`、`resizable: false`

#### IPC 通信架构

```
主进程 (main.js)
├── 存储数据、文件 I/O
├── 窗口生命周期管理
├── 系统集成（托盘、快捷方式、嵌入）
└─→ 对话框窗口
    ├── 用户填表单
    └─→ ipcMain.on('dialog-submit', ...) → 数据保存
        └─→ mainWindow.webContents.send('refresh-tasks')
            └─→ 主窗口重新渲染列表
```

---

## 桌面嵌入技术

### 1. 嵌入原理

通过 C# 编写的 `embed-helper.exe`（在运行时由 csc.exe 编译），使用 Win32 API 将 Electron 窗口挂接到 Windows 桌面后端的工作区窗口。

### 2. 编译流程 (`main.js` 中的 `compileEmbedHelper()`)

**步骤：**
1. 查找 .NET Framework csc.exe 编译器
   - 尝试路径：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`
   - 备选：`C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`
   
2. 定位源文件 `embed-helper.cs`
   - 优先从 `__dirname` 查找（开发环境）
   - 备选从 `process.resourcesPath` 查找（打包后）
   
3. 编译命令：
   ```
   csc.exe /nologo /optimize /out:"<exe路径>" "<cs文件路径>"
   ```
   - 输出路径：`%APPDATA%/GrapeNote/embed-helper.exe`
   - 编译选项：禁用版本信息（/nologo）、启用优化（/optimize）
   
4. 超时控制：30秒编译超时

### 3. 嵌入执行流程 (`embedWindowInDesktop()`)

```javascript
// 1. 获取 Electron 窗口句柄 (HWND)
const buf = mainWindow.getNativeWindowHandle();
const hwnd = buf.length >= 8 
  ? Number(buf.readBigUInt64LE(0))    // 64位
  : buf.readUInt32LE(0);               // 32位

// 2. 编译/获取 embed-helper.exe
const exe = compileEmbedHelper();
if (!exe) return false;  // 编译失败，返回 false

// 3. 执行嵌入命令
const result = execSync(`"${exe}" embed ${hwnd}`, {...}).trim();

// 4. 验证结果
if (result.startsWith('OK')) {
  // 恢复窗口位置（嵌入可能改变坐标）
  const bounds = ensureBoundsVisible(loadBoundsForCurrentDisplays());
  mainWindow.setBounds(bounds);
  return true;
}
return false;
```

### 4. embed-helper.cs 的 Win32 API 调用

**命令格式：** `embed-helper.exe embed <HWND (十进制整数)>`

**执行步骤：**

1. **查找 Progman**
   ```csharp
   IntPtr progman = FindWindow("Progman", null);
   ```
   - Progman 是 Windows 桌面程序的主窗口

2. **激活 WorkerW**
   ```csharp
   SendMessageTimeout(progman, 0x052C, UIntPtr.Zero, IntPtr.Zero, 0, 1000, out sr);
   ```
   - 消息 0x052C：强制创建/刷新 WorkerW（工作区窗口）
   - 超时 1000ms

3. **定位目标窗口（Win10/Win11 兼容策略）**
   ```csharp
   IntPtr target = IntPtr.Zero;
   IntPtr w = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "WorkerW", null);
   while (w != IntPtr.Zero) {
     if (FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
       target = FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
       break;
     }
     w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null);
   }
   if (target == IntPtr.Zero 
       && FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
     target = progman;  // Progman 本身就是目标（某些 Win11 配置）
   }
   ```
   - 策略：枚举所有 WorkerW 窗口，找到包含 SHELLDLL_DefView 的窗口
   - 该 WorkerW 的后一个 WorkerW 是目标（Win10）
   - 若无 WorkerW 但 Progman 包含 SHELLDLL_DefView，则 Progman 是目标（Win11）

4. **修改窗口样式**
   ```csharp
   uint style = GetWindowLong(ourHwnd, -16);                    // GWL_STYLE = -16
   SetWindowLong(ourHwnd, -16, (style & ~0x80000000u) | 0x40000000u);
   ```
   - 清除 `WS_POPUP` (0x80000000)
   - 添加 `WS_CHILD` (0x40000000)

5. **设置父窗口**
   ```csharp
   IntPtr prev = SetParent(ourHwnd, target);
   if (prev == IntPtr.Zero) throw error;
   ```

6. **调整窗口位置和属性**
   ```csharp
   SetWindowPos(ourHwnd, IntPtr.Zero, 0, 0, 0, 0,
                0x0020 | 0x0010 | 0x0002 | 0x0001);
   // 标志：SWP_FRAMECHANGED(0x0020) | SWP_NOZORDER(0x0010) 
   //     | SWP_NOMOVE(0x0002) | SWP_NOSIZE(0x0001)
   ```

7. **返回结果**
   - 成功：`OK:parent=<HWND值>`
   - 失败：`ERR:<错误信息>`

### 5. 嵌入失败时的备选方案

若嵌入失败（返回 false），应用启用防最小化机制：

```javascript
mainWindow.on('minimize', () => {
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.show();
    }
  }, 200);
});
```

这使窗口无法被最小化，始终保持在桌面可见。

### 6. 鼠标交互优化

桌面嵌入模式下，拖拽窗口会出现卡顿。解决方案：

```javascript
// 在 app.js DOMContentLoaded 中
document.addEventListener('mousedown', () => window.focus(), true);
```

每次鼠标按下时立即调用 `window.focus()`，确保窗口获得焦点，减少拖拽延迟。

---

## 多显示器位置记忆

### 1. 显示器配置 Key 生成

```javascript
function getDisplayKey() {
  const displays = screen.getAllDisplays()
    .map(d => `${d.bounds.width}x${d.bounds.height}`)
    .sort()
    .join('+');
  return displays;  // 例如 "1920x1080+2560x1440"
}
```

每种显示器配置（分辨率组合）生成一个唯一的 key。

### 2. 位置保存和恢复

```javascript
// 保存位置
function saveBoundsForCurrentDisplays(bounds) {
  const data = loadData();
  const key = getDisplayKey();
  if (!data.settings.displayBounds) data.settings.displayBounds = {};
  data.settings.displayBounds[key] = bounds;
  data.settings.windowBounds = bounds;  // 同时更新默认位置
  saveData(data);
}

// 恢复位置
function loadBoundsForCurrentDisplays() {
  const data = loadData();
  const key = getDisplayKey();
  const saved = (data.settings.displayBounds || {})[key];
  return saved || data.settings.windowBounds;  // 无对应配置则用默认
}
```

### 3. 确保位置在可见区域

```javascript
function ensureBoundsVisible(bounds) {
  const displays = screen.getAllDisplays();
  const cx = bounds.x + Math.round(bounds.width / 2);
  const cy = bounds.y + Math.round(bounds.height / 2);
  
  // 检查窗口中心是否在任何工作区内
  for (const d of displays) {
    const a = d.workArea;
    if (cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) {
      return bounds;
    }
  }
  
  // 超出范围，归位到主屏右下角
  const p = screen.getPrimaryDisplay().workArea;
  return {
    x: p.x + p.width - bounds.width - 20,
    y: p.y + 40,
    width: bounds.width,
    height: bounds.height
  };
}
```

### 4. 显示器变化事件监听

```javascript
screen.on('display-added', onDisplayChange);
screen.on('display-removed', onDisplayChange);

function onDisplayChange() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const saved = ensureBoundsVisible(loadBoundsForCurrentDisplays());
  mainWindow.setBounds(saved);
}
```

外接/断开显示器时自动重新定位窗口。

---

## 数据存储和配置

### 1. 文件位置

**默认路径：** `%APPDATA%/GrapeNote/tasks-data.json`

**自定义路径机制：**
- 创建 `%APPDATA%/GrapeNote/config-path.txt`
- 文件内容：自定义配置文件的完整路径
- 应用启动时检查此文件，若存在则用其内容作为配置文件路径

```javascript
function getDataFilePath() {
  try {
    if (fs.existsSync(POINTER_FILE)) {
      const p = fs.readFileSync(POINTER_FILE, 'utf-8').trim();
      if (p && fs.existsSync(path.dirname(p))) return p;
    }
  } catch (e) {}
  return path.join(DEFAULT_DATA_DIR, 'tasks-data.json');
}
```

### 2. JSON 数据结构

```json
{
  "tasks": [
    {
      "id": "xxxx-xxxx-xxxx",
      "title": "任务标题",
      "notes": "可选备注",
      "deadline": "2026-06-20",
      "completed": false,
      "completedAt": null,
      "createdAt": "2026-06-17T08:30:00.000Z",
      "recurring": null
    },
    {
      "id": "yyyy-yyyy-yyyy",
      "title": "周会",
      "notes": "",
      "deadline": "2026-06-23",
      "completed": false,
      "completedAt": null,
      "createdAt": "2026-06-17T09:00:00.000Z",
      "recurring": {
        "type": "weekly",
        "days": [1, 3, 5]
      }
    },
    {
      "id": "zzzz-zzzz-zzzz",
      "title": "月度汇总",
      "notes": "",
      "deadline": "2026-07-01",
      "completed": false,
      "completedAt": null,
      "createdAt": "2026-06-17T10:00:00.000Z",
      "recurring": {
        "type": "monthly",
        "dates": [1, 15, 30]
      }
    }
  ],
  "completedHistory": [
    {
      "id": "hist-xxxx-xxxx",
      "taskId": "original-task-id",
      "title": "任务名称快照",
      "deadline": "2026-06-16",
      "completedAt": "2026-06-17T07:00:00.000Z",
      "recurring": false,
      "notes": "备注快照"
    }
  ],
  "settings": {
    "windowBounds": {
      "x": 100,
      "y": 100,
      "width": 380,
      "height": 600
    },
    "displayBounds": {
      "1920x1080+2560x1440": { "x": 200, "y": 150, "width": 380, "height": 600 }
    },
    "bgColor": "#000000",
    "bgOpacity": 0.3,
    "textColor": "#FFFFFF",
    "fontFamily": "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif",
    "fontSize": 13,
    "cornerStyle": "round",
    "autoStart": false,
    "windowLocked": false,
    "hwAccel": true
  }
}
```

### 3. 数据对象详解

**Task 对象：**
- `id`：格式 `xxxx-xxxx-xxxx`（4位16进制随机数×3，中间 `-` 连接）
- `title`：任务标题（必填，非空）
- `notes`：任务备注（可选，可为空字符串）
- `deadline`：截止日期，格式 `YYYY-MM-DD`（可选，可为 null/空字符串）
- `completed`：布尔值，任务是否完成
- `completedAt`：完成时间戳（ISO 8601 格式，未完成时为 null）
- `createdAt`：创建时间戳（ISO 8601 格式）
- `recurring`：循环规则（null 表示不循环）

**Recurring 对象：**
- **Weekly（每周）：**
  ```json
  { "type": "weekly", "days": [0, 1, 2, 3, 4, 5, 6] }
  ```
  days 数组：0=周日, 1=周一, ..., 6=周六（可选择任意组合）

- **Monthly（每月）：**
  ```json
  { "type": "monthly", "dates": [1, 15, 30] }
  ```
  dates 数组：1-31 的日期（可选择任意组合）

**Settings 对象：**
| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `windowBounds` | Object | 窗口位置和大小 `{x, y, width, height}` | `{x:100, y:100, w:380, h:600}` |
| `displayBounds` | Object | 多显示器配置 key → bounds 映射 | `{}` |
| `bgColor` | String | 背景颜色（十六进制 #RRGGBB） | `"#000000"` |
| `bgOpacity` | Number | 背景透明度（0.0-1.0） | `0.3` |
| `textColor` | String | 文字颜色（十六进制 #RRGGBB） | `"#FFFFFF"` |
| `fontFamily` | String | CSS font-family 字符串 | `"'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif"` |
| `fontSize` | Number | 字体大小（像素 11-20） | `13` |
| `cornerStyle` | String | 窗口圆角 `"round"` 或 `"square"` | `"round"` |
| `autoStart` | Boolean | 开机自启动 | `false` |
| `windowLocked` | Boolean | 窗口位置/大小是否锁定 | `false` |
| `hwAccel` | Boolean | 硬件加速开关 | `true` |

---

## 主窗口 UI 架构

### 1. 标题栏设计

**特点：** 无文本、无图标，仅拖拽区域 + 三个小按钮（右对齐）

```html
<div class="titlebar" id="titlebar">
  <div class="titlebar-actions">
    <button class="tb-btn" id="btnAdd" title="添加任务">
      <!-- + 图标 SVG -->
    </button>
    <button class="tb-btn" id="btnSettings" title="设置">
      <!-- 齿轮图标 SVG -->
    </button>
    <button class="tb-btn" id="btnLock" title="锁定位置和大小">
      <!-- 锁图标 SVG -->
    </button>
  </div>
</div>
```

**CSS 特性：**
- `.titlebar`：`-webkit-app-region: drag;`（可拖拽区域）
- `.titlebar-actions`：`-webkit-app-region: no-drag;`（按钮不参与拖拽）
- `.tb-btn`：宽高 20px，透明背景，默认 opacity 0.25，hover 时 0.7
- 锁定时：`.tb-btn.locked` 添加 blue 色彩（`--accent`）

### 2. 任务列表显示逻辑

**排序规则：**
1. 过期任务（deadline < 今天 且 completed=false）显示在最上方
2. 过期与未过期任务之间用分割线隔开
3. 同类任务按截止日期升序排列
4. 无截止日期的任务排在最后，按创建时间升序排列
5. 已完成任务不显示

**任务项结构：**
```
[循环标记] [过期图标] [复选框] [标题] [截止日期]
```

**各组件说明：**
- **循环标记** (可选)：`🔄` emoji，右上角带 "周"/"月" 字段徽章
  ```html
  <span class="task-recurring-badge">
    🔄
    <span class="badge-label">周</span>  <!-- 或 "月" -->
  </span>
  ```

- **过期图标** (可选)：`⚠️` emoji，仅过期任务显示

- **复选框**：16px 圆形，未选中时透明背景，hover 时蓝色背景，选中时绿色背景和勾号

- **标题**：单行显示，超长截断（`text-overflow: ellipsis`）

- **截止日期**：格式 `MM/DD`，灰色文字，可选显示

### 3. 任务项 CSS 类

```css
.task-item                     /* 基础样式 */
  .task-item:hover            /* hover 背景微微变亮 */
  .task-item.overdue          /* 过期任务：标题红色 */
  .task-item.completing       /* 完成动画中：文本灰色、删除线 */
  .task-item.fade-out         /* 完成动画后期：淡出 + 滑出 */
  .task-divider               /* 过期/未过期分割线 */
  .empty-state                /* 无任务状态：显示咖啡杯 emoji + 文本 */
```

### 4. 完成任务动画

```javascript
function completeTask(id) {
  const el = document.querySelector(`.task-item[data-id="${id}"]`);
  el.classList.add('completing');           // → 文本灰色、删除线
  el.querySelector('.task-checkbox').classList.add('checked');
  
  setTimeout(() => {
    el.classList.add('fade-out');           // → 淡出 + 向右滑出
    setTimeout(() => {
      doComplete(task);
      renderTasks();
    }, 400);  // 动画时长
  }, 500);    // 显示状态时间
}
```

**CSS 动画：**
```css
.task-item.completing .task-title {
  text-decoration: line-through;
  opacity: 0.4;
}

.task-item.fade-out {
  opacity: 0;
  transform: translateX(20px);
  max-height: 0;
  padding: 0 8px;
  margin: 0;
  overflow: hidden;
  transition: all 0.4s ease;
}
```

---

## 对话框窗口（添加/编辑任务）

### 1. 窗口属性

```javascript
{
  x: mainWindowX + Math.round(mainWindowWidth / 2) - 170,
  y: mainWindowY + 60,
  width: 340,
  height: 360,  // 添加模式
  // height: 380,  // 编辑模式（多一个删除按钮）
  minWidth: 280,
  minHeight: 300,
  frame: false,
  transparent: true,
  resizable: false,
  skipTaskbar: true,
  alwaysOnTop: true,
  webPreferences: {
    preload: path.join(__dirname, 'dialog-preload.js'),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false
  }
}
```

### 2. 对话框 HTML 结构

```html
<div class="header">
  <span id="dialogTitle">添加任务</span>
  <button class="close-btn" id="btnClose">✕</button>
</div>

<div class="body">
  <div class="form-group">
    <label>标题</label>
    <input type="text" id="title" autofocus>
  </div>
  
  <div class="form-group">
    <label>备注</label>
    <textarea id="notes" rows="2"></textarea>
  </div>
  
  <div class="form-row">
    <div class="form-group half">
      <label>截止日期</label>
      <input type="date" id="deadline">
    </div>
    <div class="form-group half">
      <label>循环</label>
      <select id="recurring">
        <option value="none">不循环</option>
        <option value="weekly">每周</option>
        <option value="monthly">每月</option>
      </select>
    </div>
  </div>
  
  <div class="recurring-options" id="weeklyOptions" style="display:none;">
    <div class="weekday-buttons">
      <button class="weekday-btn" data-day="1">一</button>
      <button class="weekday-btn" data-day="2">二</button>
      <!-- ... -->
      <button class="weekday-btn" data-day="0">日</button>
    </div>
  </div>
  
  <div class="recurring-options" id="monthlyOptions" style="display:none;">
    <input type="text" id="monthlyDates" placeholder="输入日期，如 1, 15">
  </div>
</div>

<div class="footer">
  <button class="btn btn-danger" id="btnDelete" style="display:none;">删除</button>
  <button class="btn btn-primary" id="btnSubmit">添加</button>
</div>
```

### 3. 表单字段详解

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 标题 | text | 是 | 非空判断，Enter 快速提交 |
| 备注 | textarea | 否 | 可空，多行显示 |
| 截止日期 | date | 否 | HTML5 date picker，格式 YYYY-MM-DD |
| 循环类型 | select | 否 | 不循环/每周/每月，默认"不循环" |
| 星期选择 | buttons | 条件 | 循环类型="每周"时显示，多选 |
| 日期输入 | text | 条件 | 循环类型="每月"时显示，用户输入 1-31 |

### 4. 编辑模式与添加模式的差异

**添加模式：**
- 标题：`添加任务`
- 按钮：`添加`
- 无删除按钮

**编辑模式：**
- 标题：`编辑任务`
- 按钮：`保存`
- 显示删除按钮
- 预填表单字段

### 5. 快捷键

- `Enter` (在标题输入框)：提交表单
- `Escape` (全局)：关闭对话框

---

## 设置面板

### 1. 外观设置

| 设置项 | 类型 | 范围 | 说明 |
|-------|------|------|------|
| 背景颜色 | 颜色选择器 | #000000-#FFFFFF | HTML5 color input |
| 背景透明度 | 滑块 | 0-100% | 转换为 0.0-1.0 存储 |
| 文字颜色 | 颜色选择器 | #000000-#FFFFFF | HTML5 color input |
| 字体 | 下拉菜单 | 6 种 | 见下表 |
| 字体大小 | 滑块 | 11-20px | 像素值 |
| 窗口圆角 | 按钮组 | 圆角/直角 | "round" 或 "square" |

**字体选项（6 种）：**
```javascript
[
  { value: "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif", label: "默认" },
  { value: "'Microsoft YaHei', sans-serif", label: "微软雅黑" },
  { value: "'SimSun', serif", label: "宋体" },
  { value: "'KaiTi', serif", label: "楷体" },
  { value: "'Consolas', 'Courier New', monospace", label: "Consolas" },
  { value: "'Arial', sans-serif", label: "Arial" }
]
```

### 2. 系统设置

| 设置项 | 类型 | 说明 |
|-------|------|------|
| 开机自启动 | 切换开关 | `app.setLoginItemSettings()` |
| 硬件加速 | 切换开关 | 修改后需要重启应用生效 |

**硬件加速实现：**
```javascript
// main.js app.whenReady() 之前
if (initData.settings.hwAccel === false) {
  app.disableHardwareAcceleration();
}
```

### 3. 数据操作

| 操作 | 说明 | 输出格式 |
|------|------|----------|
| 导出 CSV | 导出已完成历史记录 | UTF-8 BOM + CSV |
| 导出配置 | 导出整个 appData（tasks + settings） | JSON 格式 |
| 导入配置 | 导入 JSON 配置文件 | 覆盖 tasks 和 settings |

**CSV 导出列：** `任务名称, 截止日期, 完成日期, 是否循环, 备注`

**CSV 处理：**
- 添加 UTF-8 BOM (`\uFEFF`)，使 Excel 正确识别
- 字段转义：包含逗号/引号/换行的字段用 `"` 包裹，内部引号双写

### 4. 配置文件路径管理

**显示当前路径：** `.config-path-display` 可点击，打开文件夹

**选择新路径：**
1. 打开文件对话框
2. 用户选择 JSON 文件
3. 文件不存在时自动创建
4. 写入 `config-path.txt` 指针文件
5. 下次启动自动使用新路径

**重置为默认：**
1. 删除 `config-path.txt` 指针文件
2. 恢复使用 `%APPDATA%/GrapeNote/tasks-data.json`

---

## CSS 变量系统和主题应用

### 1. 根变量定义 (styles.css :root)

```css
:root {
  --bg-color: #000000;
  --bg-opacity: 0.3;
  --text-color: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.5);
  --accent: #0078D4;
  --accent-hover: #1a86db;
  --danger: #FF6B6B;
  --success: #51CF66;
  --border: rgba(255, 255, 255, 0.1);
  --radius-window: 12px;
  --radius-card: 8px;
  --radius-btn: 6px;
  --font-family: '...';
  --font-size: 13px;
  --transition: 150ms ease;
}
```

### 2. 动态设置的变量 (app.js applyTheme())

```javascript
// RGB 分量（用于背景色计算）
--bg-r: 0;
--bg-g: 0;
--bg-b: 0;

// 背景色公式
background: rgba(var(--bg-r), var(--bg-g), var(--bg-b), var(--bg-opacity));
```

### 3. 主题应用算法

```javascript
function applyTheme() {
  const s = appData.settings;
  
  // 1. 转换背景色为 RGB 分量
  const rgb = hexToRgb(s.bgColor || '#000000');
  r.style.setProperty('--bg-r', rgb.r);
  r.style.setProperty('--bg-g', rgb.g);
  r.style.setProperty('--bg-b', rgb.b);
  
  // 2. 设置透明度
  r.style.setProperty('--bg-opacity', s.bgOpacity != null ? s.bgOpacity : 0.3);
  
  // 3. 设置文字颜色
  r.style.setProperty('--text-color', s.textColor || '#FFFFFF');
  
  // 4. 设置字体
  r.style.setProperty('--font-family', s.fontFamily);
  r.style.setProperty('--font-size', (s.fontSize || 13) + 'px');
  
  // 5. 设置圆角
  if (s.cornerStyle === 'square') {
    r.style.setProperty('--radius-window', '0px');
    r.style.setProperty('--radius-card', '0px');
    r.style.setProperty('--radius-btn', '2px');
  } else {
    r.style.setProperty('--radius-window', '12px');
    r.style.setProperty('--radius-card', '8px');
    r.style.setProperty('--radius-btn', '6px');
  }
  
  // 6. 根据文字颜色亮度调整副文字和边框
  const tc = hexToRgb(s.textColor || '#FFFFFF');
  const lum = (tc.r * 299 + tc.g * 587 + tc.b * 114) / 1000;
  
  if (lum > 128) {  // 亮色文字
    r.style.setProperty('--text-secondary', 'rgba(255,255,255,0.5)');
    r.style.setProperty('--border', 'rgba(255,255,255,0.1)');
  } else {  // 暗色文字
    r.style.setProperty('--text-secondary', 'rgba(0,0,0,0.45)');
    r.style.setProperty('--border', 'rgba(0,0,0,0.1)');
  }
}
```

### 4. 主容器样式

```css
.widget-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background: rgba(var(--bg-r, 0), var(--bg-g, 0), var(--bg-b, 0), var(--bg-opacity));
  border-radius: var(--radius-window);
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
```

---

## 循环任务处理

### 1. 完成循环任务的流程

```javascript
function doComplete(task) {
  const now = new Date().toISOString();
  
  // 1. 记录到完成历史
  appData.completedHistory.push({
    id: uid(),
    taskId: task.id,
    title: task.title,
    deadline: task.deadline,
    completedAt: now,
    recurring: !!task.recurring,
    notes: task.notes
  });
  
  // 2. 如果有循环规则，计算下一个截止日期
  if (task.recurring) {
    task.deadline = nextRecur(task.recurring, task.deadline);
    task.completed = false;
    task.completedAt = null;
  } else {
    // 3. 非循环任务，直接删除
    appData.tasks = appData.tasks.filter(t => t.id !== task.id);
  }
  
  saveAll();
}
```

### 2. 下一个循环日期计算 (nextRecur)

**入参：**
- `rec`: Recurring 对象 `{ type: "weekly"|"monthly", days?: number[], dates?: number[] }`
- `cur`: 当前截止日期（格式 "YYYY-MM-DD"）

**出参：** 下一个截止日期（格式 "YYYY-MM-DD"）

**算法：**

**周循环（weekly）：**
1. 基准日期 = 当前日期或指定日期（如果过期则改为今天）
2. 遍历下一个 1-7 天，检查星期是否在 days 数组中
3. 返回第一个匹配的日期

**月循环（monthly）：**
1. 基准日期 = 当前日期或指定日期（如果过期则改为今天）
2. 在本月内查找 > 当前日期的日期
3. 若找到，返回该日期
4. 若未找到，返回下月 dates[0]

**示例代码：**
```javascript
function nextRecur(rec, cur) {
  const td = new Date();
  td.setHours(0, 0, 0, 0);
  const base = cur ? new Date(cur + 'T00:00:00') : td;
  if (base < td) base.setTime(td.getTime());
  
  // 周循环
  if (rec.type === 'weekly' && rec.days && rec.days.length > 0) {
    const days = rec.days.sort((a, b) => a - b);
    const c = base.getDay();
    for (let o = 1; o <= 7; o++) {
      if (days.includes((c + o) % 7)) {
        const n = new Date(base);
        n.setDate(n.getDate() + o);
        return fmtISO(n);
      }
    }
  }
  
  // 月循环
  if (rec.type === 'monthly' && rec.dates && rec.dates.length > 0) {
    const dates = rec.dates.sort((a, b) => a - b);
    const cd = base.getDate();
    const cm = base.getMonth();
    const cy = base.getFullYear();
    
    for (const d of dates) {
      if (d > cd) {
        const n = new Date(cy, cm, d);
        if (n.getDate() === d) return fmtISO(n);  // 防止月份日期溢出
      }
    }
    return fmtISO(new Date(cy, cm + 1, dates[0]));
  }
  
  // 默认：下一周
  const fb = new Date(base);
  fb.setDate(fb.getDate() + 7);
  return fmtISO(fb);
}

function fmtISO(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}
```

---

## 右键菜单和快捷操作

### 1. 右键菜单触发

```javascript
item.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  showCtx(e.clientX, e.clientY, task.id);
});
```

### 2. 菜单项

| 项目 | 操作 | 样式 |
|------|------|------|
| 编辑 | 打开编辑对话框 | 默认（灰色） |
| 删除 | 删除任务 | 危险色（红色） |

### 3. 位置调整

菜单显示在鼠标位置，超出窗口边界时自动调整：
```javascript
const r = m.getBoundingClientRect();
if (r.right > window.innerWidth) m.style.left = (x - r.width) + 'px';
if (r.bottom > window.innerHeight) m.style.top = (y - r.height) + 'px';
```

---

## 锁定功能

### 1. 实现原理

```javascript
ipcMain.handle('set-window-lock', (_, locked) => {
  if (!mainWindow) return false;
  mainWindow.setResizable(!locked);
  mainWindow.setMovable(!locked);
  const data = loadData();
  data.settings.windowLocked = locked;
  saveData(data);
  return locked;
});
```

### 2. UI 反馈

```javascript
function updateLockBtn(locked) {
  const btn = document.getElementById('btnLock');
  if (locked) {
    btn.classList.add('locked');
    btn.title = '解锁位置和大小';
  } else {
    btn.classList.remove('locked');
    btn.title = '锁定位置和大小';
  }
}
```

**locked 状态下的 CSS：**
```css
.tb-btn.locked {
  opacity: 0.7;
  color: var(--accent);  /* 蓝色 */
}
```

---

## IPC 通信接口

### 主进程 ↔ 主窗口 (preload.js)

**window.api.* 方法：**

| 方法 | 参数 | 返回类型 | 说明 |
|------|------|----------|------|
| `getData()` | — | Promise<data> | 获取所有数据 |
| `saveData(data)` | data object | Promise<true> | 保存数据 |
| `openAddDialog()` | — | Promise<true> | 打开添加对话框 |
| `openEditDialog(task)` | task object | Promise<true> | 打开编辑对话框 |
| `onRefreshTasks(callback)` | callback func | void | 监听刷新信号 |
| `exportCSV(csv)` | csv string | Promise<result> | 导出 CSV |
| `exportConfig()` | — | Promise<result> | 导出配置 |
| `importConfig()` | — | Promise<result> | 导入配置 |
| `getConfigPath()` | — | Promise<string> | 获取配置文件路径 |
| `setConfigPath()` | — | Promise<result> | 设置配置文件路径 |
| `resetConfigPath()` | — | Promise<result> | 重置为默认路径 |
| `openConfigFolder()` | — | Promise<true> | 打开配置文件夹 |
| `setAutoStart(enable)` | enable bool | Promise<bool> | 设置开机自启 |
| `getAutoStart()` | — | Promise<bool> | 获取开机自启状态 |
| `setWindowLock(locked)` | locked bool | Promise<bool> | 锁定窗口 |
| `getWindowLock()` | — | Promise<bool> | 获取锁定状态 |
| `getHwAccel()` | — | Promise<bool> | 获取硬件加速状态 |
| `setHwAccel(enable)` | enable bool | Promise<bool> | 设置硬件加速 |

### 主进程 ↔ 对话框窗口 (dialog-preload.js)

**window.dialogAPI.* 方法：**

| 方法 | 参数 | 返回类型 | 说明 |
|------|------|----------|------|
| `getInitData()` | — | {mode, task} | 获取初始化数据（同步） |
| `submit(formData)` | {title, notes, deadline, recurring} | void | 提交表单 |
| `deleteTask()` | — | void | 删除任务 |
| `cancel()` | — | void | 取消关闭 |

**初始化数据格式：**
```javascript
{
  mode: 'add' | 'edit',
  task: null | <Task对象>
}
```

### IPC 事件处理 (main.js ipcMain)

**同步事件 (sendSync)：**
- `dialog-get-init-data`：获取对话框初始数据

**异步单向事件 (send)：**
- `dialog-submit`：对话框提交表单
- `dialog-delete`：对话框删除任务
- `dialog-cancel`：对话框取消
- `refresh-tasks`：主进程通知主窗口刷新任务列表

**异步双向事件 (handle)：**
- `get-data`
- `save-data`
- `open-add-dialog`
- `open-edit-dialog`
- `export-csv`
- `export-config`
- `import-config`
- `get-config-path`
- `set-config-path`
- `reset-config-path`
- `open-config-folder`
- `set-window-lock`
- `get-window-lock`
- `set-auto-start`
- `get-auto-start`
- `get-hw-accel`
- `set-hw-accel`

---

## 文件结构

```
sticky-tasks/
├── package.json                # Electron 项目配置
├── main.js                     # 主进程（Electron 核心）
├── preload.js                  # 主窗口预加载脚本
├── dialog-preload.js           # 对话框预加载脚本
├── index.html                  # 主窗口 HTML
├── task-dialog.html            # 对话框 HTML
├── styles.css                  # 主窗口 CSS（主题系统）
├── app.js                      # 主窗口前端逻辑
├── embed-helper.cs             # Win32 嵌入助手（C#）
├── build.bat                   # 构建脚本
├── icon.png                    # 应用图标（≥16x16）
└── dist/                       # 构建输出目录
    └── GrapeNote Setup 1.1.2.exe
```

---

## 应用生命周期

### 1. 启动流程

1. **读取硬件加速设置** (main.js 顶级)
   ```javascript
   if (initData.settings.hwAccel === false) {
     app.disableHardwareAcceleration();
   }
   ```

2. **app.whenReady()**
   - 创建主窗口 (`createWindow()`)
   - 恢复窗口位置 (displayBounds 或 windowBounds)
   - 应用主题样式

3. **窗口 ready-to-show**
   - 尝试嵌入到桌面 (`embedWindowInDesktop()`)
   - 如果嵌入失败，启用防最小化备选方案
   - 读取窗口锁定状态

4. **创建系统托盘** (`createTray()`)

5. **监听显示器变化事件**
   ```javascript
   screen.on('display-added', onDisplayChange);
   screen.on('display-removed', onDisplayChange);
   ```

6. **主窗口加载 index.html**
   - app.js 中 DOMContentLoaded 事件触发
   - 加载数据 (`api.getData()`)
   - 应用主题 (`applyTheme()`)
   - 渲染任务列表 (`renderTasks()`)
   - 绑定事件 (`bindEvents()`)

### 2. 单实例锁

```javascript
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
```

### 3. 窗口关闭行为

- **用户点击关闭按钮**：阻止关闭，隐藏窗口
  ```javascript
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  ```

- **用户从托盘菜单退出**：设置 `app.isQuitting = true`，允许关闭

- **窗口移动/调整大小**：自动保存位置和大小
  ```javascript
  mainWindow.on('moved', saveWindowBounds);
  mainWindow.on('resized', saveWindowBounds);
  ```

### 4. 数据保存触发点

- 用户修改任何设置（背景色、字体等）
- 用户完成任务
- 用户添加/编辑/删除任务
- 窗口移动或调整大小
- 用户修改开机自启或硬件加速设置

---

## 构建和发布

### 1. 开发环境

```bash
npm install
npm start
```

### 2. 构建可执行文件

**使用 build.bat：**
```batch
cd sticky-tasks
build.bat
```

**手动构建：**
```bash
npm run build
```

### 3. 构建流程

1. 清理 `node_modules` 和 `dist` 目录
2. 运行 `npm install` 安装依赖
3. 运行 `npm run build` 打包

### 4. 输出文件

- `dist/GrapeNote Setup 1.1.2.exe`：NSIS 安装程序
- 安装程序支持：
  - 自定义安装位置
  - 自动创建开始菜单快捷方式
  - 卸载功能

### 5. package.json 构建配置

```json
{
  "build": {
    "appId": "com.grape.grapenote",
    "productName": "GrapeNote",
    "win": {
      "target": "nsis",
      "icon": "icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "extraResources": [
      { "from": "embed-helper.cs", "to": "embed-helper.cs" }
    ]
  }
}
```

---

## 核心数据流

### 1. 添加任务流程

```
用户点击 + 按钮
  ↓
api.openAddDialog()
  ↓
main.js: openTaskDialog('add', null)
  ↓
创建对话框窗口 (task-dialog.html)
  ↓
对话框 → dialog-preload.js: getInitData() [同步]
  ↓
用户填表单 → 点击提交
  ↓
dialog-preload.js: submit(formData)
  ↓
main.js: ipcMain.on('dialog-submit', ...)
  ↓
main.js: saveData() + mainWindow.webContents.send('refresh-tasks')
  ↓
app.js: onRefreshTasks 回调
  ↓
renderTasks() 重新渲染列表
```

### 2. 编辑任务流程

类似添加流程，但：
- `openTaskDialog('edit', task)`
- 对话框预填表单
- 显示删除按钮
- 按钮文本为"保存"

### 3. 完成任务流程

```
用户点击复选框
  ↓
completeTask(taskId)
  ↓
添加 'completing' 和 'fade-out' 样式
  ↓
动画完成后，调用 doComplete(task)
  ↓
记录到 completedHistory
  ↓
if (task.recurring) {
  计算下一个截止日期
  重置 completed=false
} else {
  删除任务
}
  ↓
saveAll()
  ↓
renderTasks()
```

---

## 系统集成

### 1. 开机自启动

```javascript
app.setLoginItemSettings({
  openAtLogin: enable,
  path: process.execPath
});
```

Windows 将应用注册到注册表启动项 (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`)。

### 2. 系统托盘

**托盘图标：** 16x16px 渐变蓝色圆形背景 + 白色方形（使用 Buffer 像素绘制）

**菜单项：**
- 显示窗口
- 隐藏窗口
- ---
- 退出应用

**双击托盘图标：** 显示和激活主窗口

### 3. 文件关联

无（可在 package.json 中添加）

---

## 样式 CSS 类详解

### 主窗口 (styles.css)

```css
/* 容器 */
.widget-container          /* 主容器，毛玻璃效果 */
.titlebar                  /* 标题栏，可拖拽 */
.titlebar-actions          /* 按钮容器，不可拖拽 */
.tb-btn                    /* 小按钮 (20×20px) */
.tb-btn.locked             /* 锁定状态（蓝色） */

/* 任务列表 */
.task-list-container       /* 滚动容器 */
.task-list                 /* 任务项包装 */
.task-item                 /* 单个任务行 */
.task-item:hover           /* hover 状态 */
.task-item.overdue         /* 过期任务（标题红色） */
.task-item.completing      /* 完成中（文本灰色、删除线） */
.task-item.fade-out        /* 淡出动画（透明 + 滑出） */
.task-divider              /* 过期/未过期分割线 */
.empty-state               /* 无任务状态 */

/* 任务项内部 */
.task-recurring-badge      /* 循环标记 emoji */
.badge-label               /* 循环类型标签 (周/月) */
.task-overdue-icon         /* 过期警告 emoji */
.task-checkbox             /* 复选框 (圆形) */
.task-checkbox:hover       /* hover 蓝色背景 */
.task-checkbox.checked     /* 选中（绿色 + 勾号） */
.task-content              /* 标题 + 元数据容器 */
.task-title                /* 任务标题 */
.task-meta                 /* 元数据（截止日期） */
.task-deadline             /* 截止日期文本 */

/* 设置面板 */
.settings-overlay          /* 全屏半透明背景 */
.settings-panel            /* 设置面板主容器 */
.settings-header           /* 标题栏 */
.settings-close            /* 关闭按钮 */
.settings-body             /* 内容区域 */
.settings-section-title    /* 分类标题 (大小写) */
.setting-item              /* 单个设置项 */
.setting-color             /* 颜色选择器 */
.setting-range             /* 滑块 */
.setting-range-value       /* 滑块数值显示 */
.setting-select            /* 下拉菜单 */
.corner-toggle             /* 圆角/直角按钮组 */
.corner-btn                /* 单个切换按钮 */
.corner-btn.active         /* 活跃状态 */
.setting-action-btn        /* 操作按钮 (导出/导入等) */
.toggle-switch             /* 开关组件 */
.toggle-slider             /* 开关滑块 */
.config-path-display       /* 配置路径显示区域 */
.setting-hint              /* 提示文本 (硬件加速提示) */
.settings-version          /* 版本号显示 */

/* 右键菜单 */
.context-menu              /* 菜单容器 */
.context-menu-item         /* 菜单项 */
.context-menu-item.ctx-danger  /* 危险项（红色） */

/* 对话框 (task-dialog.html) */
.header                    /* 对话框头部 */
.close-btn                 /* 关闭按钮 */
.body                      /* 对话框内容区 */
.form-group                /* 表单字段容器 */
.form-row                  /* 多列表单 */
.form-group.half           /* 半宽表单字段 */
.weekday-buttons           /* 星期选择按钮组 */
.weekday-btn               /* 单个星期按钮 */
.weekday-btn.selected      /* 选中的星期 */
.recurring-options         /* 循环选项容器 */
.footer                    /* 对话框底部按钮区 */
.btn                       /* 按钮基础样式 */
.btn-primary               /* 蓝色主按钮 */
.btn-danger                /* 红色危险按钮 */
```

---

## 异常处理和日志

### 常见错误场景

| 场景 | 错误信息 | 处理方案 |
|------|----------|---------|
| embed-helper.cs 丢失 | `Embed: .cs not found` | 继续使用防最小化模式 |
| csc.exe 找不到 | `Embed: csc.exe not found` | 继续使用防最小化模式 |
| 编译失败 | `Embed: compile failed: ...` | 继续使用防最小化模式 |
| Progman 窗口不存在 | `ERR:no_progman` | 嵌入失败，使用备选方案 |
| 无适合的 WorkerW | `ERR:no_target` | 嵌入失败，使用备选方案 |
| 数据文件损坏 | `读取数据失败: ...` | 使用默认数据继续运行 |
| 配置路径指针失效 | N/A | 自动恢复默认路径 |

### 调试方法

在 `main.js` 中添加：
```javascript
mainWindow.webContents.openDevTools();  // 打开开发者工具
console.log(...);                       // 输出到控制台
```

---

## 技术栈要求

### 前端
- HTML5：现代 Web 标准
- CSS3：CSS 变量、Backdrop Filter、Flexbox、Grid
- JavaScript (ES6+)：Promise、箭头函数、模板字符串、async/await

### 后端/主进程
- Node.js 16.0+
- Electron 31.0.0+
- electron-builder 24.13.3+

### 系统集成
- C# (.NET Framework 4.0+)
- Win32 API（user32.dll）

### 系统要求
- Windows 7 SP1+ 或更高版本
- .NET Framework 4.0 或更高版本（编译 embed-helper.cs 时需要）
- 硬件：无特殊要求

---

## 已知限制

1. **仅支持 Windows**：桌面嵌入依赖 Win32 API
2. **嵌入后无键盘**：主窗口嵌入后失去焦点，无法接收键盘输入
3. **单显示器嵌入**：嵌入仅在主显示器有效
4. **背景图片变化**：桌面背景更换可能导致嵌入失效
5. **性能限制**：任务超过 1000+ 项时可能出现滚动卡顿

---

## 项目总结

**GrapeNote v1.1.2** 是一个功能完整的 Windows 桌面任务管理小部件，核心特性：

✓ 透明毛玻璃窗口嵌入到 Windows 桌面  
✓ 完整的任务管理（添加、编辑、删除、完成）  
✓ 每周/每月循环任务支持  
✓ 过期任务标记和优先排序  
✓ 高度可定制的主题（颜色、透明度、字体、圆角）  
✓ 任务数据导出/导入（CSV + JSON）  
✓ 完成历史记录导出  
✓ 配置文件路径自定义  
✓ 开机自启动  
✓ 窗口位置锁定  
✓ 多显示器位置记忆  
✓ 硬件加速开关  
✓ 系统托盘集成  
✓ 单实例运行  
✓ 右键菜单快捷操作  

本规范文档提供了完整的实现细节、API 签名、数据结构和技术方案，足以让另一个 LLM 从零开始重新实现整个项目。

