/**
 * OBS 监控大盘 — Electron 桌面应用 v1.3.0
 * 打包后可分发为 .exe，双击启动
 *
 * 兼容说明：开发模式下 node_modules/electron 会遮蔽 Electron 内置模块
 * 导致 require('electron') 返回 npm stub（二进制路径字符串）而非 API 对象
 * 解决方案：清除 npm stub 的 require.cache，通过 rescan 强制走 Electron 内置解析
 */
const path = require('path');
const Module = require('module');

function _loadElectronBuiltin() {
  // npm 安装的 electron 包 index.js 导出字符串（exe 路径），
  // 仅在开发模式（electron .）时 node_modules/electron 会遮蔽 Electron 内置模块。
  // 打包为 asar 后无此问题 —— asar 内部没有 node_modules。
  var m = require('electron');
  var isDev = (typeof m === 'string' || (m && !m.app)) && __filename.indexOf('.asar') < 0;
  if (isDev) {
    // 开发模式：清除 npm stub 缓存，从 module.paths 中移除项目 node_modules
    // 让下一次 require('electron') 走 Electron 内置解析
    for (var k of Object.keys(require.cache)) {
      if (k.indexOf('electron') >= 0) delete require.cache[k];
    }
    // 只移除当前项目目录下的 node_modules（基于 __filename 推断项目根目录）
    var projRoot = require('path').dirname(require('path').dirname(__filename));
    var savedPaths = module.paths.slice();
    module.paths = module.paths.filter(function(p) {
      return p.indexOf(projRoot) < 0;
    });
    try {
      m = require('electron');
    } finally {
      module.paths = savedPaths;
    }
  }
  return m;
}

const electron = _loadElectronBuiltin();
const { app, BrowserWindow, dialog } = electron;
const http = require('http');
const fs = require('fs');

// ipcMain may not be available in older Electron versions
let ipcMain = null;
try { ipcMain = electron.ipcMain; } catch(e) {}


const PORT = 8392;
const HERE = path.dirname(__dirname); // Claw 目录

// ═══════════════════════════════════════
// OBS 编码器配置读取
// ═══════════════════════════════════════
const OBS_BASE = path.join(process.env.APPDATA || '', 'obs-studio', 'basic');

function findActiveProfile() {
  const profilesDir = path.join(OBS_BASE, 'profiles');
  if (!fs.existsSync(profilesDir)) return null;
  let best = null, bestMtime = 0;
  for (const name of fs.readdirSync(profilesDir)) {
    const d = path.join(profilesDir, name);
    if (!fs.statSync(d).isDirectory()) continue;
    const ini = path.join(d, 'basic.ini');
    if (fs.existsSync(ini)) {
      const mtime = fs.statSync(ini).mtimeMs;
      if (mtime > bestMtime) { bestMtime = mtime; best = d; }
    }
  }
  return best;
}

function readEncoderConfigs(profileDir) {
  const result = {};
  const files = {};
  if (!profileDir || !fs.existsSync(profileDir)) return { data: result, files: files };
  for (const fname of fs.readdirSync(profileDir)) {
    if (!fname.endsWith('.json')) continue;
    if (!/ncoder|obs_|ffmpeg_|amd_|jim_/.test(fname)) continue;
    try {
      const raw = fs.readFileSync(path.join(profileDir, fname), 'utf-8');
      result[fname.replace('.json', '')] = JSON.parse(raw);
      files[fname.replace('.json', '')] = fname;
    } catch (_) {}
  }
  return { data: result, files: files };
}

function writeEncoderConfig(profileDir, params) {
  if (!profileDir || !fs.existsSync(profileDir)) return { ok: false, error: 'No profile directory' };
  const { data, files } = readEncoderConfigs(profileDir);
  var targetKey = null;
  for (var key of Object.keys(files)) {
    if (key === 'streamEncoder') { targetKey = key; break; }
    if (key.startsWith('obs_nvenc') && !targetKey) { targetKey = key; }
    if (key.startsWith('obs_x264') && !targetKey) { targetKey = key; }
    if (!targetKey) targetKey = key;
  }
  if (!targetKey) {
    targetKey = 'streamEncoder';
    files[targetKey] = 'streamEncoder.json';
  }
  var cfg = data[targetKey] || {};
  for (var p in params) { cfg[p] = params[p]; }
  var filePath = path.join(profileDir, files[targetKey]);
  try {
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), 'utf-8');
    return { ok: true, file: files[targetKey], key: targetKey, written: Object.keys(params) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════
// HTTP 服务器
// ═══════════════════════════════════════
const profileDir = findActiveProfile();
const PROJECT_DIR = path.dirname(path.dirname(__filename)); // 项目根目录 (electron/ 的父目录)

// ★ 热更新：每次请求都重新读取 HTML（避免修改后需重启应用）
function loadDashboardHTML() {
  const altHTML = path.join(path.dirname(process.execPath), 'obs-dashboard.html');
  const externalHTML = path.join(PROJECT_DIR, 'obs-dashboard.html');
  try {
    if (fs.existsSync(altHTML)) {
      return fs.readFileSync(altHTML, 'utf-8');
    } else if (fs.existsSync(externalHTML)) {
      return fs.readFileSync(externalHTML, 'utf-8');
    }
  } catch(e) { console.error('[OBS-Dashboard] 读取 HTML 失败:', e.message); }
  return '<h1>缺少 obs-dashboard.html 文件</h1>';
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(loadDashboardHTML());
    return;
  }

  if (req.url === '/encoder-settings') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          var params = JSON.parse(body);
          var result = writeEncoderConfig(profileDir, params);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    // GET
    const cfg = readEncoderConfigs(profileDir);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(cfg.data));
    return;
  }

  if (req.url === '/obs-rooms.json') {
    try {
      const roomsJSON = fs.readFileSync(path.join(PROJECT_DIR, 'obs-rooms.json'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(roomsJSON);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('[]');
    }
    return;
  }

  if (req.url === '/health') {
    const ok = !!(profileDir && fs.existsSync(profileDir));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(ok ? 'OK' : 'NO-PROFILE');
    return;
  }

  if (req.url.startsWith('/open-folder')) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const dir = url.searchParams.get('path');
    if (!dir || !fs.existsSync(dir)) { res.writeHead(400); res.end('Invalid path'); return; }
    require('child_process').exec('explorer "' + dir + '"');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (req.url === '/save-log' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.path || !data.content) { res.writeHead(400); res.end('Missing'); return; }
        const dir = path.dirname(data.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(data.path, data.content, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, path: data.path }));
      } catch (e) { res.writeHead(500); res.end(e.message); }
    });
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

// ═══════════════════════════════════════
// Electron 导出/导入 — 原生对话框（ipcMain 可用时启用）
// ═══════════════════════════════════════
if (ipcMain) {
  ipcMain.handle('export-config-dialog', async (event, jsonContent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: '导出配置',
      defaultPath: 'obs-config.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, jsonContent, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle('import-config-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: '导入配置',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      return { success: true, content: content };
    }
    return { success: false };
  });
}

// ═══════════════════════════════════════
// Electron 窗口管理
// ═══════════════════════════════════════
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OBS 直播间监控大盘',
    icon: undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://127.0.0.1:' + PORT);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  // 启动 HTTP 服务
  server.listen(PORT, '127.0.0.1', () => {
    console.log('OBS 监控大盘 HTTP 服务: http://127.0.0.1:' + PORT);
    createWindow();
  });
});

app.on('window-all-closed', () => {
  server.close();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
