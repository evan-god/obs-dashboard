/**
 * OBS 日志服务 v1.0
 * 部署在每台 OBS 主机上，自动发现日志路径，提供 HTTP API
 * 纯 Node.js，零依赖，端口 8393
 *
 * 用法: node obs-log-service.js
 * 部署: 运行 install-obs-log-service.bat（自动添加开机自启）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ═══════════════════════════════════════
// 自动发现 OBS 日志目录
// ═══════════════════════════════════════
function findObsLogs() {
  const candidates = [];

  // 1. %APPDATA%/obs-studio/logs（标准安装，最常见）
  try {
    const appdata = process.env.APPDATA;
    if (appdata) {
      const p = path.join(appdata, 'obs-studio', 'logs');
      if (fs.existsSync(p)) candidates.push(p);
    }
  } catch (_) {}

  // 2. 便携模式：检查常见安装目录下是否有 portable_mode.txt
  const portableRoots = [
    path.dirname(process.execPath),                          // 服务脚本所在目录的父级
    'C:\\Program Files\\obs-studio',
    'C:\\Program Files (x86)\\obs-studio',
    path.join(os.homedir(), 'obs-studio'),
    'D:\\obs-studio',
  ];
  for (const root of portableRoots) {
    try {
      if (
        fs.existsSync(path.join(root, 'portable_mode.txt')) ||
        fs.existsSync(path.join(root, 'obs_portable_mode'))
      ) {
        const p = path.join(root, 'config', 'obs-studio', 'logs');
        if (fs.existsSync(p)) candidates.push(p);
      }
    } catch (_) {}
  }

  return candidates[0] || null;
}

const LOG_DIR = findObsLogs();
const PORT = 8393;

// ═══════════════════════════════════════
// HTTP 服务
// ═══════════════════════════════════════
function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  // CORS：允许任意来源（仪表盘可能是任意 LAN 地址）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /status — 健康检查
  if (req.url === '/status') {
    sendJSON(res, 200, {
      ok: true,
      host: os.hostname(),
      logDir: LOG_DIR || null,
      found: !!LOG_DIR,
      uptime: Math.floor(process.uptime()),
    });
    return;
  }

  // 日志目录未找到 → 所有 /logs 路由返回 500
  if (!LOG_DIR) {
    sendJSON(res, 500, { ok: false, error: 'OBS 日志目录未找到。请确认 OBS 已至少运行过一次。', host: os.hostname() });
    return;
  }

  // GET /logs — 列出所有日志文件
  if (req.url === '/logs' || req.url.startsWith('/logs?')) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const wantedName = url.searchParams.get('name') || '';

      // 如果指定了 name → 返回内容
      if (wantedName) {
        const fp = path.join(LOG_DIR, wantedName);
        if (!fs.existsSync(fp)) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const content = fs.readFileSync(fp, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
        return;
      }

      // 否则列出文件
      const files = fs.readdirSync(LOG_DIR)
        .filter(function (f) { return f.endsWith('.txt'); })
        .sort()
        .reverse()
        .map(function (f) {
          var fp = path.join(LOG_DIR, f);
          try {
            var st = fs.statSync(fp);
            return { name: f, mtime: st.mtime.toISOString(), size: st.size };
          } catch (_) {
            return { name: f, mtime: '', size: 0 };
          }
        });
      sendJSON(res, 200, { ok: true, host: os.hostname(), logDir: LOG_DIR, files: files });
    } catch (e) {
      sendJSON(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  // GET /logs/latest — 最新日志（纯文本）
  if (req.url.startsWith('/logs/latest')) {
    try {
      var allFiles = fs.readdirSync(LOG_DIR)
        .filter(function (f) { return f.endsWith('.txt'); })
        .sort()
        .reverse();
      if (allFiles.length === 0) {
        res.writeHead(404);
        res.end('No logs');
        return;
      }
      var latestPath = path.join(LOG_DIR, allFiles[0]);
      var content = fs.readFileSync(latestPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(content);
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', function () {
  console.log('OBS Log Service v1.0');
  console.log('  Port:    ' + PORT);
  console.log('  Log dir: ' + (LOG_DIR || 'NOT FOUND'));
  console.log('  Status:  http://' + (getLanIP() || '127.0.0.1') + ':' + PORT + '/status');
});

// ═══════════════════════════════════════
// 辅助：获取局域网 IP
// ═══════════════════════════════════════
function getLanIP() {
  var ifaces = os.networkInterfaces();
  for (var name in ifaces) {
    for (var i = 0; i < ifaces[name].length; i++) {
      var addr = ifaces[name][i];
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}
