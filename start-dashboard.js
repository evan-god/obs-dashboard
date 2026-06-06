/**
 * OBS 监控大盘 — 一键启动（单进程，零依赖）v1.3.0
 *   node start-dashboard.js
 *   自动启动 HTTP 服务 + 读取编码器配置 + 打开浏览器
 *   Ctrl+C 关闭
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec, execSync, spawn } = require('child_process');

const PORT  = 8392;
const HERE  = __dirname;
const OBS_BASE = path.join(process.env.APPDATA || '', 'obs-studio', 'basic');

// ═══════════════════════════════════════════════════════════
//  读取 OBS 编码器 JSON 配置
// ═══════════════════════════════════════════════════════════
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
    // streamEncoder.json / recordEncoder.json / obs_xxx.json 等
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
  // 找到 streaming encoder 对应的 JSON 文件
  // 优先级：streamEncoder > obs_nvenc* > obs_x264* > 第一个匹配的
  var targetKey = null;
  for (var key of Object.keys(files)) {
    if (key === 'streamEncoder') { targetKey = key; break; }
    if (key.startsWith('obs_nvenc') && !targetKey) { targetKey = key; }
    if (key.startsWith('obs_x264') && !targetKey) { targetKey = key; }
    if (!targetKey) targetKey = key;
  }
  if (!targetKey) {
    // 没有找到已有文件，创建新的 streamEncoder.json
    targetKey = 'streamEncoder';
    files[targetKey] = 'streamEncoder.json';
  }
  var cfg = data[targetKey] || {};
  // 合并参数
  for (var p in params) { cfg[p] = params[p]; }
  var filePath = path.join(profileDir, files[targetKey]);
  try {
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), 'utf-8');
    return { ok: true, file: files[targetKey], key: targetKey, written: Object.keys(params) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
//  HTTP 服务器
// ═══════════════════════════════════════════════════════════
const profileDir = findActiveProfile();
const dashboardHTML = fs.readFileSync(path.join(HERE, 'obs-dashboard.html'), 'utf-8');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardHTML);
    return;
  }

  if (req.url === '/encoder-settings') {
    if (req.method === 'POST') {
      var body = '';
      req.on('data', function(c) { body += c; });
      req.on('end', function() {
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
      const roomsJSON = fs.readFileSync(path.join(HERE, 'obs-rooms.json'), 'utf-8');
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
    if (!dir || !fs.existsSync(dir)) {
      res.writeHead(400); res.end('Invalid or missing path'); return;
    }
    exec('explorer "' + dir + '"', (err) => {
      if (err) { res.writeHead(500); res.end(err.message); return; }
    });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // ★ v1.3.9.5 直接写 basic.ini 参数（用于录像格式等 WebSocket API 改不了的配置）
  if (req.url === '/basic-ini' && req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        // data.section: 'AdvOut', data.key: 'RecFormat', data.value: 'mp4'
        if (!data.section || !data.key) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Missing section or key' })); return;
        }
        var iniPath = path.join(profileDir, 'basic.ini');
        if (!fs.existsSync(iniPath)) {
          res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'basic.ini not found' })); return;
        }
        var content = fs.readFileSync(iniPath, 'utf-8');
        var lines = content.split(/\r?\n/);
        var inSection = false;
        var found = false;
        var sectionHeader = '[' + data.section + ']';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line === sectionHeader) {
            inSection = true;
            continue;
          }
          if (inSection && line.startsWith('[')) break;
          if (inSection && line.startsWith(data.key + '=')) {
            lines[i] = data.key + '=' + data.value;
            found = true;
            break;
          }
        }
        if (!found) {
          // 在 section 末尾追加
          var insertAt = -1;
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].trim() === sectionHeader) {
              inSection = true;
              continue;
            }
            if (inSection && lines[j].trim().startsWith('[')) { insertAt = j; break; }
          }
          if (insertAt < 0) insertAt = lines.length;
          lines.splice(insertAt, 0, data.key + '=' + data.value);
        }
        fs.writeFileSync(iniPath, lines.join('\r\n'), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, section: data.section, key: data.key, value: data.value }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.url === '/save-log' && req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        if (!data.path || !data.content) { res.writeHead(400); res.end('Missing path or content'); return; }
        var dir = path.dirname(data.path);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(data.path, data.content, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, path: data.path, dir: dir }));
      } catch (e) {
        res.writeHead(500); res.end(e.message);
      }
    });
    return;
  }

  // ═══ OBS 日志读取（支持 ?host=IP）v1.5.2 ═══
  var _logUrl = new URL(req.url, 'http://127.0.0.1');
  var _logHost = _logUrl.searchParams.get('host') || '';

  // ---- 凭据管理 ----
  var _credsFile = path.join(HERE, 'obs-credentials.json');
  var _credentials = {};
  function _loadCreds() {
    if (fs.existsSync(_credsFile)) {
      try { _credentials = JSON.parse(fs.readFileSync(_credsFile, 'utf-8')); } catch(e) {}
    }
  }
  function _saveCreds() {
    fs.writeFileSync(_credsFile, JSON.stringify(_credentials, null, 2));
  }
  _loadCreds();

  function _ensureNetUse(host) {
    if (!host || host === '127.0.0.1' || host === 'localhost') return true;
    var cred = _credentials[host];
    if (!cred || !cred.user || !cred.pass) return false;
    try {
      try { execSync('net use "\\\\' + host + '\\C$" /delete /y', { stdio: 'pipe' }); } catch(e) {}
      execSync('net use "\\\\' + host + '\\C$" /user:' + cred.user + ' ' + cred.pass + ' /persistent:no', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch(e) { return false; }
  }

  function _getLogDir(host) {
    if (!host || host === '127.0.0.1' || host === 'localhost') {
      return path.join(process.env.APPDATA || '', 'obs-studio', 'logs');
    }
    var cred = _credentials[host];
    var user = cred ? cred.user : 'Administrator';
    return '\\\\' + host + '\\C$\\Users\\' + user + '\\AppData\\Roaming\\obs-studio\\logs';
  }

  // POST /credentials — 保存单条凭据
  if (_logUrl.pathname === '/credentials' && req.method === 'POST') {
    var _body = '';
    req.on('data', function(c) { _body += c; });
    req.on('end', function() {
      try {
        var d = JSON.parse(_body);
        if (d.host && d.user && d.pass) {
          _credentials[d.host] = { user: d.user, pass: d.pass };
          _saveCreds();
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'Missing fields' }));
        }
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // POST /credentials-batch — 批量导入凭据（CSV 或 JSON）
  if (_logUrl.pathname === '/credentials-batch' && req.method === 'POST') {
    var _b2 = '';
    req.on('data', function(c) { _b2 += c; });
    req.on('end', function() {
      try {
        var d = JSON.parse(_b2);
        var imported = 0;
        if (Array.isArray(d)) {
          for (var i = 0; i < d.length; i++) {
            if (d[i].host && d[i].user && d[i].pass) {
              _credentials[d[i].host] = { user: d[i].user, pass: d[i].pass };
              imported++;
            }
          }
        } else if (d.credentials && Array.isArray(d.credentials)) {
          for (var i = 0; i < d.credentials.length; i++) {
            var c = d.credentials[i];
            if (c.host && c.user && c.pass) {
              _credentials[c.host] = { user: c.user, pass: c.pass };
              imported++;
            }
          }
        }
        _saveCreds();
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
  if (_logUrl.pathname === '/credentials' && req.method === 'GET') {
    var _list = [];
    for (var h in _credentials) {
      _list.push({ host: h, user: _credentials[h].user });
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, credentials: _list }));
    return;
  }

  // DELETE /credentials?host=xxx — 删除凭据
  if (_logUrl.pathname === '/credentials' && req.method === 'DELETE') {
    var _delHost = _logUrl.searchParams.get('host');
    if (_delHost && _credentials[_delHost]) {
      delete _credentials[_delHost];
      _saveCreds();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Credential not found' }));
    }
    return;
  }

  // GET/POST /start-log-server — 启动或重启 log-server 子进程
  if (_logUrl.pathname === '/start-log-server') {
    if (logServerChild) {
      // 已经在运行
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, message: 'log-server already running', pid: logServerChild.pid }));
    } else {
      try {
        startLogServer();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, message: 'log-server started', pid: logServerChild ? logServerChild.pid : null }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }
    return;
  }

  // ---- 以下日志接口均支持 ?host= 参数 ----
  var _logDir;
  try {
    if (_logHost && _logHost !== '127.0.0.1' && _logHost !== 'localhost') {
      if (!_ensureNetUse(_logHost)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Cannot connect to ' + _logHost + ', check credentials in obs-credentials.json' }));
        return;
      }
      _logDir = _getLogDir(_logHost);
    } else {
      _logDir = path.join(process.env.APPDATA || '', 'obs-studio', 'logs');
    }
  } catch(e) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
    return;
  }

  // GET /obs-logs — 列出日志文件
  if (_logUrl.pathname === '/obs-logs' && !_logUrl.searchParams.has('name') && !_logUrl.searchParams.has('latest')) {
    try {
      if (!fs.existsSync(_logDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, files: [] }));
        return;
      }
      var files = [];
      for (var f of fs.readdirSync(_logDir)) {
        if (!f.endsWith('.txt')) continue;
        var fp = path.join(_logDir, f);
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

  // GET /obs-logs/latest — 最新日志内容
  if (_logUrl.pathname === '/obs-logs/latest' || (_logUrl.pathname === '/obs-logs' && _logUrl.searchParams.has('latest'))) {
    try {
      if (!fs.existsSync(_logDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Log directory not found' }));
        return;
      }
      var files = [];
      for (var f of fs.readdirSync(_logDir)) {
        if (!f.endsWith('.txt')) continue;
        var fp = path.join(_logDir, f);
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

  // GET /obs-logs?name=xxx — 指定日志文件
  if (_logUrl.pathname === '/obs-logs' && _logUrl.searchParams.has('name')) {
    var fname = _logUrl.searchParams.get('name');
    if (!fname) { res.writeHead(400); res.end('Missing name'); return; }
    var fp = path.join(_logDir, fname);
    if (path.dirname(fp) !== _logDir || !fs.existsSync(fp)) {
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

server.listen(PORT, '127.0.0.1', () => {
  console.log('═'.repeat(48));
  console.log('  OBS 直播间监控大盘');
  console.log(`  本地服务: http://127.0.0.1:${PORT}`);
  console.log(`  配置目录: ${profileDir || '(未找到)'}`);
  console.log('  按 Ctrl+C 停止所有服务');
  console.log('═'.repeat(48));

  // ═══════════════════════════════════════════════════════════
//  自动启动 log-server.js（远程日志服务）
// ═══════════════════════════════════════════════════════════
const LOG_SERVER_PORT = 8393;
let logServerChild = null;

function startLogServer() {
  const logServerPath = path.join(HERE, 'log-server.js');
  if (!fs.existsSync(logServerPath)) {
    console.log('  ⚠  log-server.js 未找到，跳过日志服务');
    return;
  }
  try {
    logServerChild = spawn(process.execPath, [logServerPath], {
      cwd: HERE,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    logServerChild.stdout.on('data', function(d) {
      process.stdout.write('  [log-server] ' + d);
    });
    logServerChild.stderr.on('data', function(d) {
      process.stderr.write('  [log-server] ' + d);
    });
    logServerChild.on('error', function(e) {
      console.log('  ⚠  日志子进程启动失败: ' + e.message);
    });
    logServerChild.on('exit', function(code) {
      console.log('  [log-server] 已退出 (code=' + code + ')，5秒后自动重启...');
      logServerChild = null;
      setTimeout(startLogServer, 5000);
    });
    console.log('  ✔ log-server 已启动（端口 ' + LOG_SERVER_PORT + '）');
  } catch(e) {
    console.log('  ⚠  无法启动 log-server: ' + e.message);
  }
}

function stopLogServer() {
  if (logServerChild) {
    try { logServerChild.kill(); } catch(e) {}
    logServerChild = null;
  }
}

startLogServer();

// 打开浏览器
  exec(`start "" "http://127.0.0.1:${PORT}/"`);
});

// 退出清理
process.on('SIGINT', () => { stopLogServer(); console.log('\n  已停止'); server.close(); process.exit(0); });
