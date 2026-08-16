// app.js — GrapeNote v1.0.2
// 主窗口前端：只负责显示任务列表和设置面板（均不需要键盘输入）
// 添加/编辑任务由独立弹窗处理

let appData = { tasks: [], completedHistory: [], settings: {} };
let contextMenuTaskId = null;

document.addEventListener('DOMContentLoaded', async () => {
  appData = await window.api.getData();
  const s = appData.settings;
  if (!s.fontFamily) s.fontFamily = "'Segoe UI Variable', 'Segoe UI', 'Microsoft YaHei UI', sans-serif";
  if (!s.fontSize) s.fontSize = 13;
  if (!s.cornerStyle) s.cornerStyle = 'round';

  applyTheme();
  renderTasks();
  bindEvents();

  const locked = await window.api.getWindowLock();
  updateLockBtn(locked);

  // 桌面嵌入模式下，点击瞬间主动激活窗口，避免拖拽卡顿
  document.addEventListener('mousedown', () => window.focus(), true);

  // 监听主进程的刷新通知（对话框提交后触发）
  window.api.onRefreshTasks(async () => {
    appData = await window.api.getData();
    renderTasks();
  });
});

// ========== 工具 ==========

function uid() { return 'xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random()*16|0).toString(16)); }
function today() { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtDate(s) { if(!s) return ''; const p=s.split('-'); return p[1]+'/'+p[2]; }
function fmtISO(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function isOverdue(t) { return t.deadline && !t.completed && t.deadline < today(); }
function sortTasks(tasks) {
  const td = today();
  return tasks.slice().sort((a,b) => {
    const ao=a.deadline&&a.deadline<td&&!a.completed, bo=b.deadline&&b.deadline<td&&!b.completed;
    if(ao&&!bo) return -1; if(!ao&&bo) return 1;
    if(a.deadline&&!b.deadline) return -1; if(!a.deadline&&b.deadline) return 1;
    if(a.deadline&&b.deadline) return a.deadline.localeCompare(b.deadline);
    return (a.createdAt||'').localeCompare(b.createdAt||'');
  });
}
async function saveAll() { await window.api.saveData(appData); }

// ========== 主题 ==========

function hexToRgb(h) { return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}; }

function applyTheme() {
  const s = appData.settings, rgb = hexToRgb(s.bgColor||'#000000'), r = document.documentElement;
  r.style.setProperty('--bg-r', rgb.r); r.style.setProperty('--bg-g', rgb.g); r.style.setProperty('--bg-b', rgb.b);
  r.style.setProperty('--bg-opacity', s.bgOpacity!=null?s.bgOpacity:0.3);
  r.style.setProperty('--text-color', s.textColor||'#FFFFFF');
  r.style.setProperty('--font-family', s.fontFamily);
  r.style.setProperty('--font-size', (s.fontSize||13)+'px');
  if (s.cornerStyle==='square') { r.style.setProperty('--radius-window','0px'); r.style.setProperty('--radius-card','0px'); r.style.setProperty('--radius-btn','2px'); }
  else { r.style.setProperty('--radius-window','12px'); r.style.setProperty('--radius-card','8px'); r.style.setProperty('--radius-btn','6px'); }
  const tc = hexToRgb(s.textColor||'#FFFFFF'), lum = (tc.r*299+tc.g*587+tc.b*114)/1000;
  if (lum>128) { r.style.setProperty('--text-secondary','rgba(255,255,255,0.5)'); r.style.setProperty('--border','rgba(255,255,255,0.1)'); }
  else { r.style.setProperty('--text-secondary','rgba(0,0,0,0.45)'); r.style.setProperty('--border','rgba(0,0,0,0.1)'); }
}

// ========== 渲染任务 ==========

function renderTasks() {
  const container = document.getElementById('taskList');
  const empty = document.getElementById('emptyState');
  let list = sortTasks(appData.tasks.filter(t => !t.completed));
  container.innerHTML = '';
  if (list.length===0) { empty.style.display='flex'; return; }
  empty.style.display='none';
  let hasOd=false, div=false;
  list.forEach(task => {
    const od=isOverdue(task);
    if(hasOd&&!od&&!div) { const d=document.createElement('div'); d.className='task-divider'; container.appendChild(d); div=true; }
    if(od) hasOd=true;
    container.appendChild(mkTask(task,od));
  });
}

function getRecurLabel(rec) { if(!rec) return ''; if(rec.type==='weekly') return '周'; if(rec.type==='monthly') return '月'; return ''; }

function mkTask(task, od) {
  const item = document.createElement('div');
  item.className = 'task-item'+(od?' overdue':'');
  item.dataset.id = task.id;

  if (task.recurring) {
    const badge = document.createElement('span');
    badge.className = 'task-recurring-badge';
    badge.textContent = '🔄';
    const lbl = document.createElement('span');
    lbl.className = 'badge-label';
    lbl.textContent = getRecurLabel(task.recurring);
    badge.appendChild(lbl);
    item.appendChild(badge);
  }

  if (od) { const i=document.createElement('span'); i.className='task-overdue-icon'; i.textContent='⚠️'; item.appendChild(i); }

  const cb = document.createElement('div');
  cb.className = 'task-checkbox';
  cb.addEventListener('click', (e) => { e.stopPropagation(); completeTask(task.id); });
  item.appendChild(cb);

  const content = document.createElement('div');
  content.className = 'task-content';
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  content.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  if (task.deadline) { const dl=document.createElement('span'); dl.className='task-deadline'; dl.textContent=fmtDate(task.deadline); meta.appendChild(dl); }
  content.appendChild(meta);
  item.appendChild(content);

  // 点击打开编辑对话框（独立窗口）
  item.addEventListener('click', () => { window.api.openEditDialog(task); });
  item.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e.clientX,e.clientY,task.id); });
  return item;
}

// ========== 完成任务 ==========

function completeTask(id) {
  const task = appData.tasks.find(t=>t.id===id);
  if(!task) return;
  const el = document.querySelector(`.task-item[data-id="${id}"]`);
  if(el) {
    el.classList.add('completing');
    const cb=el.querySelector('.task-checkbox'); if(cb) cb.classList.add('checked');
    setTimeout(()=>{ el.classList.add('fade-out'); setTimeout(()=>{ doComplete(task); renderTasks(); },400); },500);
  } else { doComplete(task); renderTasks(); }
}

function doComplete(task) {
  const now = new Date().toISOString();
  appData.completedHistory.push({ id:uid(), taskId:task.id, title:task.title, deadline:task.deadline, completedAt:now, recurring:!!task.recurring, notes:task.notes });
  if(task.recurring) {
    task.deadline = nextRecur(task.recurring, task.deadline);
    task.completed=false; task.completedAt=null;
  } else { appData.tasks = appData.tasks.filter(t=>t.id!==task.id); }
  saveAll();
}

function nextRecur(rec, cur) {
  const td=new Date(); td.setHours(0,0,0,0);
  const base=cur?new Date(cur+'T00:00:00'):td;
  if(base<td) base.setTime(td.getTime());
  if(rec.type==='weekly'&&rec.days&&rec.days.length>0) {
    const days=rec.days.sort((a,b)=>a-b), c=base.getDay();
    for(let o=1;o<=7;o++) { if(days.includes((c+o)%7)) { const n=new Date(base); n.setDate(n.getDate()+o); return fmtISO(n); } }
  }
  if(rec.type==='monthly'&&rec.dates&&rec.dates.length>0) {
    const dates=rec.dates.sort((a,b)=>a-b), cd=base.getDate(), cm=base.getMonth(), cy=base.getFullYear();
    for(const d of dates) { if(d>cd) { const n=new Date(cy,cm,d); if(n.getDate()===d) return fmtISO(n); } }
    return fmtISO(new Date(cy,cm+1,dates[0]));
  }
  const fb=new Date(base); fb.setDate(fb.getDate()+7); return fmtISO(fb);
}

// ========== 事件绑定 ==========

function bindEvents() {
  // 添加任务：打开独立窗口
  document.getElementById('btnAdd').addEventListener('click', () => { window.api.openAddDialog(); });

  // 锁定
  document.getElementById('btnLock').addEventListener('click', async () => {
    const cur = await window.api.getWindowLock();
    const ns = await window.api.setWindowLock(!cur);
    updateLockBtn(ns);
  });

  // 设置
  bindSettings();

  // 右键菜单
  document.addEventListener('click', hideCtx);
  document.getElementById('ctxEdit').addEventListener('click', () => {
    if(contextMenuTaskId) {
      const task = appData.tasks.find(t=>t.id===contextMenuTaskId);
      if(task) window.api.openEditDialog(task);
    }
    hideCtx();
  });
  document.getElementById('ctxDelete').addEventListener('click', () => {
    if(contextMenuTaskId) { appData.tasks=appData.tasks.filter(t=>t.id!==contextMenuTaskId); saveAll(); renderTasks(); }
    hideCtx();
  });

  document.addEventListener('keydown', (e) => {
    if(e.key==='Escape') { document.getElementById('settingsOverlay').style.display='none'; hideCtx(); }
  });
}

// ========== 设置面板 ==========

function bindSettings() {
  const overlay = document.getElementById('settingsOverlay');
  document.getElementById('btnSettings').addEventListener('click', async () => {
    const s=appData.settings;
    document.getElementById('settingBgColor').value = s.bgColor||'#000000';
    document.getElementById('settingBgOpacity').value = Math.round((s.bgOpacity!=null?s.bgOpacity:0.3)*100);
    document.getElementById('opacityValue').textContent = Math.round((s.bgOpacity!=null?s.bgOpacity:0.3)*100)+'%';
    document.getElementById('settingTextColor').value = s.textColor||'#FFFFFF';
    document.getElementById('settingFontSize').value = s.fontSize||13;
    document.getElementById('fontSizeValue').textContent = (s.fontSize||13)+'px';
    const fs=document.getElementById('settingFontFamily');
    for(let i=0;i<fs.options.length;i++) { if(fs.options[i].value===s.fontFamily) { fs.selectedIndex=i; break; } }
    document.getElementById('cornerRound').classList.toggle('active', s.cornerStyle!=='square');
    document.getElementById('cornerSquare').classList.toggle('active', s.cornerStyle==='square');
    document.getElementById('settingAutoStart').checked = await window.api.getAutoStart();
    document.getElementById('settingHwAccel').checked = await window.api.getHwAccel();
    document.getElementById('hwAccelHint').style.display = 'none';
    document.getElementById('configPathDisplay').textContent = await window.api.getConfigPath();
    overlay.style.display='flex';
  });

  document.getElementById('settingsClose').addEventListener('click', ()=>{ overlay.style.display='none'; });
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.style.display='none'; });

  document.getElementById('settingBgColor').addEventListener('input', (e)=>{ appData.settings.bgColor=e.target.value; applyTheme(); saveAll(); });
  document.getElementById('settingBgOpacity').addEventListener('input', (e)=>{ const v=parseInt(e.target.value); document.getElementById('opacityValue').textContent=v+'%'; appData.settings.bgOpacity=v/100; applyTheme(); saveAll(); });
  document.getElementById('settingTextColor').addEventListener('input', (e)=>{ appData.settings.textColor=e.target.value; applyTheme(); saveAll(); });
  document.getElementById('settingFontFamily').addEventListener('change', (e)=>{ appData.settings.fontFamily=e.target.value; applyTheme(); saveAll(); });
  document.getElementById('settingFontSize').addEventListener('input', (e)=>{ const v=parseInt(e.target.value); document.getElementById('fontSizeValue').textContent=v+'px'; appData.settings.fontSize=v; applyTheme(); saveAll(); });

  document.getElementById('cornerRound').addEventListener('click', ()=>{ appData.settings.cornerStyle='round'; document.getElementById('cornerRound').classList.add('active'); document.getElementById('cornerSquare').classList.remove('active'); applyTheme(); saveAll(); });
  document.getElementById('cornerSquare').addEventListener('click', ()=>{ appData.settings.cornerStyle='square'; document.getElementById('cornerSquare').classList.add('active'); document.getElementById('cornerRound').classList.remove('active'); applyTheme(); saveAll(); });

  document.getElementById('settingAutoStart').addEventListener('change', async (e)=>{ await window.api.setAutoStart(e.target.checked); });
  document.getElementById('settingHwAccel').addEventListener('change', async (e)=>{ await window.api.setHwAccel(e.target.checked); document.getElementById('hwAccelHint').style.display='block'; });

  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportConfig').addEventListener('click', async ()=>{ await window.api.exportConfig(); });
  document.getElementById('btnImportConfig').addEventListener('click', async ()=>{ const r=await window.api.importConfig(); if(r.success) { appData=await window.api.getData(); applyTheme(); renderTasks(); } });

  document.getElementById('configPathDisplay').addEventListener('click', async ()=>{ await window.api.openConfigFolder(); });
  document.getElementById('btnSetConfigPath').addEventListener('click', async ()=>{ const r=await window.api.setConfigPath(); if(r.success) { document.getElementById('configPathDisplay').textContent=r.path; appData=await window.api.getData(); applyTheme(); renderTasks(); } });
  document.getElementById('btnResetConfigPath').addEventListener('click', async ()=>{ const r=await window.api.resetConfigPath(); if(r.success) { document.getElementById('configPathDisplay').textContent=r.path; appData=await window.api.getData(); applyTheme(); renderTasks(); } });
}

async function exportCSV() {
  const recs=appData.completedHistory;
  if(recs.length===0) return;
  const hdr=['任务名称','截止日期','完成日期','是否循环','备注'];
  const rows=recs.map(r=>[esc(r.title||''),esc(r.deadline||''),esc(r.completedAt?r.completedAt.slice(0,10):''),r.recurring?'是':'否',esc(r.notes||'')].join(','));
  await window.api.exportCSV([hdr.join(','),...rows].join('\n'));
}
function esc(s) { return (s.includes(',')||s.includes('"')||s.includes('\n'))?'"'+s.replace(/"/g,'""')+'"':s; }

// ========== 右键菜单 ==========

function showCtx(x,y,id) {
  contextMenuTaskId=id;
  const m=document.getElementById('contextMenu');
  m.style.display='block'; m.style.left=x+'px'; m.style.top=y+'px';
  const r=m.getBoundingClientRect();
  if(r.right>window.innerWidth) m.style.left=(x-r.width)+'px';
  if(r.bottom>window.innerHeight) m.style.top=(y-r.height)+'px';
}
function hideCtx() { document.getElementById('contextMenu').style.display='none'; contextMenuTaskId=null; }

// ========== 锁定按钮 ==========

function updateLockBtn(locked) {
  const btn=document.getElementById('btnLock');
  if(locked) {
    btn.classList.add('locked');
    btn.title='解锁位置和大小';
    btn.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M4 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>';
  } else {
    btn.classList.remove('locked');
    btn.title='锁定位置和大小';
    btn.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M4 5V3.5a2 2 0 0 1 4 0V2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>';
  }
}
