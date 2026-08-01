#!/usr/bin/env node
/**
 * notify.js — 机票低价监控 → Server酱（个人微信）推送
 *
 * 两种用法：
 *   1) 命令行：node scripts/notify.js   （读 .env 的 SCT_SENDKEY，推 data/summary.txt）
 *   2) 被设置页/测试复用：const { push } = require('./notify')
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

/**
 * 向 Server酱 推送一条消息
 * @returns {{ok:boolean, message?:string, error?:string}}
 */
async function push(sendkey, title, desp) {
  if (!sendkey) return { ok: false, error: '缺少 sendkey' };
  const url = `https://sctapi.ftqq.com/${sendkey}.send`;
  const body = new URLSearchParams({ title, desp }).toString();
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.code === 0) return { ok: true, message: json.message || 'OK' };
      lastErr = `HTTP ${res.status} / code ${json.code} / ${json.message || '无消息'}`;
      console.warn(`⚠️ 第 ${attempt} 次推送返回异常：${lastErr}`);
    } catch (e) {
      lastErr = e.message;
      console.warn(`⚠️ 第 ${attempt} 次推送网络异常：${lastErr}`);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
  }
  return { ok: false, error: lastErr };
}

// 仅当作为命令行直接运行时执行
if (require.main === module) {
  (async () => {
    const SENDKEY = process.env.SCT_SENDKEY || process.env.SERVERCHAN_SENDKEY;
    if (!SENDKEY) { console.warn('⚠️ 未设置 SCT_SENDKEY，跳过推送。'); process.exit(0); }
    const summaryPath = path.join(ROOT, 'data', 'summary.txt');
    if (!fs.existsSync(summaryPath)) { console.error('❌ 找不到 data/summary.txt，请先运行 build.js'); process.exit(1); }
    const desp = fs.readFileSync(summaryPath, 'utf8').trim();
    if (!desp) { console.error('❌ summary.txt 为空，跳过推送。'); process.exit(0); }
    let originLabel = '广州(CAN)', dateLabel = '';
    try {
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'flights.json'), 'utf8'));
      if (Array.isArray(d.origins) && d.origins.length) originLabel = d.origins.map(o => `${o.city || o.code}(${o.code})`).join(' / ');
      else if (d.origin) originLabel = `${d.origin.city}(${d.origin.code})`;
      if (d.window && d.window.start) dateLabel = d.window.start.slice(5) + (d.window.end ? '~' + d.window.end.slice(5) : '');
    } catch (e) {}
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const title = `✈️ ${originLabel} 机票低价提醒 · ${dateLabel || today}`;
    const r = await push(SENDKEY, title, desp);
    if (r.ok) { console.log('✅ Server酱推送成功：', r.message); process.exit(0); }
    console.error('❌ 推送失败：', r.error); process.exit(1);
  })();
}

module.exports = { push, loadEnv };
