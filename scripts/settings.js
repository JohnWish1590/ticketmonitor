#!/usr/bin/env node
/**
 * settings.js — 本地设置服务器
 *
 * 启动：node scripts/settings.js   （或 npm run settings）
 * 浏览器会自动打开 http://127.0.0.1:8777 ，即可图形化配置机票监控系统。
 *
 * 它做的事：
 *   GET  /             -> 返回 settings.html
 *   GET  /api/config   -> 读 config.json + .env 里的 SendKey
 *   POST /api/config   -> 写 config.json（并可选写 .env 的 SendKey）
 *   POST /api/test     -> 发一条 Server酱 测试推送，验证 key 是否有效
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { push } = require('./notify');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8777;
const HOST = '127.0.0.1';
const CONFIG_PATH = path.join(ROOT, 'config.json');
const ENV_PATH = path.join(ROOT, '.env');

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; }
}
function writeConfig(cfg) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n'); }
function readEnv() {
  const m = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const mm = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (mm) m[mm[1]] = mm[2].replace(/^["']|["']$/g, '');
    }
  }
  return m;
}
function writeEnv(sendkey) { fs.writeFileSync(ENV_PATH, `SCT_SENDKEY=${sendkey || ''}\n`); }

function send(res, code, obj, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(type ? obj : JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    const html = fs.readFileSync(path.join(ROOT, 'settings.html'));
    return send(res, 200, html, 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url === '/api/config') {
    return send(res, 200, { config: readConfig(), sendkey: readEnv().SCT_SENDKEY || '' });
  }
  if (req.method === 'POST' && url === '/api/config') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.config) writeConfig(data.config);
        if (typeof data.sendkey === 'string') writeEnv(data.sendkey.trim());
        send(res, 200, { ok: true });
      } catch (e) { send(res, 400, { ok: false, error: e.message }); }
    });
    return;
  }
  if (req.method === 'POST' && url === '/api/test') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const key = (data.sendkey || readEnv().SCT_SENDKEY || '').trim();
        const r = await push(
          key,
          '✈️ 机票监控 · 推送测试',
          '这是一条来自设置页面的测试消息。\n若你收到，说明 Server酱 推送已配置成功 ✅'
        );
        send(res, 200, r);
      } catch (e) { send(res, 500, { ok: false, error: e.message }); }
    });
    return;
  }
  send(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  const addr = `http://${HOST}:${PORT}`;
  console.log('✅ 设置页面已启动：' + addr);
  console.log('   按 Ctrl+C 退出。');
  const cmd = process.platform === 'win32' ? `start "" "${addr}"`
    : process.platform === 'darwin' ? `open "${addr}"`
    : `xdg-open "${addr}"`;
  exec(cmd, (err) => { if (err) console.log('   请手动在浏览器打开：' + addr); });
});
