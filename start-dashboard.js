/**
 * OBS 监控大盘 — 一键启动（单进程，零依赖）v1.3.0
 *   node start-dashboard.js
 *   自动启动 HTTP 服务 + 读取编码器配置 + 打开浏览器
 *   Ctrl+C 关闭
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

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
  if (!profileDir || !fs.existsSync(profileDir)) return result;
  for (const fname of fs.readdirSync(profileDir)) {
    if (!fname.endsWith('.json')) continue;
    // streamEncoder.json / recordEncoder.json / obs_xxx.json 等
    if (!/ncoder|obs_|ffmpeg_|amd_|jim_/.test(fname)) continue;
    try {
      const raw = fs.readFileSync(path.join(profileDir, fname), 'utf-8');
      result[fname.replace('.json', '')] = JSON.parse(raw);
    } catch (_) {}
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
//  HTTP 服务器
// ═══════════════════════════════════════════════════════════
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

  // 打开浏览器
  exec(`start "" "http://127.0.0.1:${PORT}/"`);
});

// 退出清理
process.on('SIGINT', () => { console.log('\n  已停止'); server.close(); process.exit(0); });
