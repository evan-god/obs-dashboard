/**
 * OBS 监控大盘 — Electron 桌面应用 v1.3.0
 * 打包后可分发为 .exe，双击启动
 */
const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ipcMain may not be available in older Electron versions
let ipcMain = null;
try { ipcMain = require('electron').ipcMain; } catch(e) {}


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
  if (!profileDir || !fs.existsSync(profileDir)) return result;
  for (const fname of fs.readdirSync(profileDir)) {
    if (!fname.endsWith('.json')) continue;
    if (!/ncoder|obs_|ffmpeg_|amd_|jim_/.test(fname)) continue;
    try {
      const raw = fs.readFileSync(path.join(profileDir, fname), 'utf-8');
      result[fname.replace('.json', '')] = JSON.parse(raw);
    } catch (_) {}
  }
  return result;
}

// ═══════════════════════════════════════
// HTTP 服务器
// ═══════════════════════════════════════
const profileDir = findActiveProfile();
const dashboardHTML = fs.readFileSync(path.join(HERE, 'obs-dashboard.html'), 'utf-8');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHTML);
    return;
  }

  if (req.url === '/encoder-settings') {
    const cfg = readEncoderConfigs(profileDir);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(cfg));
    return;
  }

  if (req.url === '/obs-rooms.json') {
    const roomsJSON = fs.readFileSync(path.join(HERE, 'obs-rooms.json'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(roomsJSON);
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
