/**
 * OBS 日志服务器 — 支持远程主机日志读取 (端口 8393)
 *   node log-server.js
 *   支持 ?host=IP 参数读取远程主机日志
 *   远程日志通过 net use \\IP\C$ 访问
 *   Ctrl+C 关闭
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 8393;
const LOG_DIR = path.join(process.env.APPDATA || '', 'obs-studio', 'logs');
const CREDS_FILE = path.join(__dirname, 'obs-credentials.json');

// === 凭据管理 ===
var credentials = {};
function loadCredentials() {
  if (fs.existsSync(CREDS_FILE)) {
    try { credentials = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8')); } catch(e) {}
  }
}
function saveCredentials() {
  fs.writeFileSync(CREDS_FILE, JSON.stringify(credentials, null, 2));
}
loadCredentials();

// === net use 连接远程主机 ===
function ensureNetUse(host) {
  if (!host || host === '127.0.0.1' || host === 'localhost') return true;
  var cred = credentials[host];
  if (!cred || !cred.user || !cred.pass) return false;
  try {
    try { execSync('net use "\\\\' + host + '\\C$" /delete /y', { stdio: 'pipe' }); } catch(e) {}
    execSync('net use "\\\\' + host + '\\C$" /user:' + cred.user + ' ' + cred.pass + ' /persistent:no', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch(e) { return false; }
}

// === 获取日志目录（本地或远程 UNC 路径）===
function getLogDir(host) {
  if (!host || host === '127.0.0.1' || host === 'localhost') return LOG_DIR;
  var cred = credentials[host];
  var user = cred ? cred.user : 'Administrator';
  return '\\\\' + host + '\\C$\\Users\\' + user + '\\AppData\\Roaming\\obs-studio\\logs';
}

// === 从 CSV 导入凭据 ===
function importCredentialsFromCSV(csvText) {
  var lines = csvText.replace(/\r/g, '').split('\n').filter(function(l) { return l.trim() && !l.startsWith('#'); });
  // 检测表头
  var start = 0;
  if (lines[0] && lines[0].toLowerCase().indexOf('host') >= 0) start = 1;
  var imported = 0;
  for (var i = start; i < lines.length; i++) {
    var parts = lines[i].split(',');
    if (parts.length >= 3) {
      var h = parts[0].replace(/"/g, '').trim();
      var u = parts[1].replace(/"/g, '').trim();
      var p = parts.slice(2).join(',').replace(/"/g, '').trim();
      if (h && u && p) { credentials[h] = { user: u, pass: p }; imported++; }
    }
  }
  saveCredentials();
  return imported;
}

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  var urlObj = new URL(req.url, 'http://127.0.0.1');
  var pathname = urlObj.pathname;
  var host = urlObj.searchParams.get('host') || '';

  // GET /health — 健康检查
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  // POST /credentials — 保存单条凭据
  if (pathname === '/credentials' && req.method === 'POST' && !urlObj.searchParams.has('csv')) {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var d = JSON.parse(body);
        if (d.host && d.user && d.pass) {
          credentials[d.host] = { user: d.user, pass: d.pass };
          saveCredentials();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, host: d.host }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Missing fields (host, user, pass)' }));
        }
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /credentials?csv=1 — 从 CSV 批量导入
  if (pathname === '/credentials' && req.method === 'POST' && urlObj.searchParams.has('csv')) {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var imported = importCredentialsFromCSV(body);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, imported: imported }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /credentials — 列出所有凭据（不含密码）
  if (pathname === '/credentials' && req.method === 'GET') {
    var list = [];
    for (var h in credentials) {
      list.push({ host: h, user: credentials[h].user });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, credentials: list }));
    return;
  }

  // DELETE /credentials?host=xxx — 删除凭据
  if (pathname === '/credentials' && req.method === 'DELETE') {
    var delHost = urlObj.searchParams.get('host');
    if (delHost && credentials[delHost]) {
      delete credentials[delHost];
      saveCreds();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Credential not found' }));
    }
    return;
  }

  // === 以下日志接口均支持 ?host= 参数 ===
  var logDir;
  try {
    if (host && host !== '127.0.0.1' && host !== 'localhost') {
      if (!ensureNetUse(host)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot connect to ' + host + ', check credentials in obs-credentials.json' }));
        return;
      }
      logDir = getLogDir(host);
    } else {
      logDir = LOG_DIR;
    }
  } catch(e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
    return;
  }

  // GET /obs-logs — 列出所有日志文件（按时间倒序）
  if (pathname === '/obs-logs' && !urlObj.searchParams.has('name') && !urlObj.searchParams.has('latest')) {
    try {
      if (!fs.existsSync(logDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, files: [] }));
        return;
      }
      var files = [];
      for (var f of fs.readdirSync(logDir)) {
        if (!f.endsWith('.txt')) continue;
        var fp = path.join(logDir, f);
        var st = fs.statSync(fp);
        files.push({ name: f, size: st.size, mtime: st.mtime.toISOString() });
      }
      files.sort(function(a, b) { return b.mtime.localeCompare(a.mtime); });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, files: files }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /obs-logs/latest — 返回最新日志文件内容
  if (pathname === '/obs-logs/latest' || (pathname === '/obs-logs' && urlObj.searchParams.has('latest'))) {
    try {
      if (!fs.existsSync(logDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Log directory not found' }));
        return;
      }
      var files = [];
      for (var f of fs.readdirSync(logDir)) {
        if (!f.endsWith('.txt')) continue;
        var fp = path.join(logDir, f);
        files.push({ name: f, path: fp, mtime: fs.statSync(fp).mtimeMs });
      }
      if (files.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'No log files found' }));
        return;
      }
      files.sort(function(a, b) { return b.mtime - a.mtime; });
      var latest = files[0];
      var content = fs.readFileSync(latest.path, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: latest.name, size: latest.size, content: content }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /obs-logs?name=xxx — 读取指定日志文件
  if (pathname === '/obs-logs' && urlObj.searchParams.has('name')) {
    var fname = urlObj.searchParams.get('name');
    if (!fname) { res.writeHead(400); res.end('Missing name'); return; }
    var fp = path.join(logDir, fname);
    if (path.dirname(fp) !== logDir || !fs.existsSync(fp)) {
      res.writeHead(404); res.end('File not found'); return;
    }
    try {
      var content = fs.readFileSync(fp, 'utf-8');
      var st = fs.statSync(fp);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: fname, size: st.size, content: content }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', function() {
  console.log('═'.repeat(48));
  console.log('  OBS 日志服务器 (支持远程主机)');
  console.log('  端口: ' + PORT);
  console.log('  日志目录: ' + LOG_DIR);
  console.log('  凭据文件: ' + CREDS_FILE);
  console.log('  API: /obs-logs?host=IP  /obs-logs/latest?host=IP');
  console.log('═'.repeat(48));
});

process.on('SIGINT', function() {
  console.log('\n  日志服务器已停止');
  server.close();
  process.exit(0);
});
