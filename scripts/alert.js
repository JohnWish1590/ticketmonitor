#!/usr/bin/env node
/**
 * alert.js — 触发式「实时特价」提醒
 *
 * 思路：机票特价窗口往往只有几小时到一天，每天推一次汇总没时效性。
 * 这里改成「触发式」：每轮抓取后，找出满足 alerts 配置（往返 ≤ maxPrice 或
 * 折扣 ≥ minDiscount）的航线，和上一轮状态比对，只对「新出现 / 更便宜」的航线
 * 立即推微信，避免刷屏；同航线冷却期满后才允许再次提醒。
 *
 * 状态存 data/alert-state.json：本地直接读写；GitHub Actions 下由工作流用
 * artifact 跨次运行持久化（脚本本身只管读写这个文件）。
 *
 * 用法：node scripts/alert.js   （被 pipeline.js 在 build 之后调用）
 *       SendKey 取 process.env.SCT_SENDKEY，本地也可放 .env（loadEnv 自动加载）
 */
const fs = require('fs');
const path = require('path');
const { push, loadEnv } = require('./notify');

const ROOT = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'alert-state.json');
const SEEN_PRUNE_DAYS = 7; // 多少天没再出现的航线，从状态里清除（以便重新出现时再提醒）

loadEnv();

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 3600000;
}

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function tripDays(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

async function main() {
  const cfg = loadJSON(path.join(ROOT, 'config.json'), {});
  const alerts = cfg.alerts || {};
  // SendKey 优先级：仓库 Secret(SCT_SENDKEY) > .env > 网页填写并写回 config.json 的 alerts.sendKey
  const SENDKEY = process.env.SCT_SENDKEY || process.env.SERVERCHAN_SENDKEY || (alerts.sendKey || '');
  if (alerts.enabled === false) { console.log('⏸ 实时提醒已关闭（config.alerts.enabled=false），跳过。'); return; }
  if (!SENDKEY) { console.warn('⚠️ 未设置 SCT_SENDKEY，跳过实时提醒（本地可放 .env，Actions 用 Secret）。'); return; }

  const maxPrice = (typeof alerts.maxPrice === 'number') ? alerts.maxPrice : null;
  const minDiscount = (typeof alerts.minDiscount === 'number') ? alerts.minDiscount : null;
  const cooldown = (typeof alerts.cooldownHours === 'number') ? alerts.cooldownHours : 24;
  if (maxPrice == null && minDiscount == null) {
    console.log('⏸ 未配置任何触发条件（maxPrice / minDiscount 均为空），跳过。'); return;
  }

  const flights = loadJSON(path.join(ROOT, 'data', 'flights.json'), null);
  if (!flights || !Array.isArray(flights.routes)) {
    console.error('❌ 找不到 data/flights.json，请先运行 scrape.js / pipeline.js'); process.exit(1);
  }

  const state = loadJSON(STATE_PATH, {});
  const now = new Date().toISOString();
  const candidates = [];
  let metThreshold = 0; // 达到阈值的航线数（含被去重未推送的）

  for (const r of flights.routes) {
    const meetsPrice = (maxPrice != null) && r.minPrice <= maxPrice;
    const meetsDisc = (minDiscount != null) && (r.discountPct || 0) >= minDiscount;
    if (!(meetsPrice || meetsDisc)) continue;
    metThreshold++;

    const key = (r.originCode || '?') + '|' + r.code; // 按出发地+目的地区分，避免双机场/多出发地去重串味
    const prev = state[key];
    const isNew = !prev;
    const isCheaper = prev && r.minPrice < prev.price;
    const cooldownOk = !prev || hoursSince(prev.lastAlertAt) >= cooldown;

    // 触发推送的条件（满足任一）：
    //  - 新出现（之前没提醒过）
    //  - 更便宜（比上次提醒的价格更低 → 立刻推，不受冷却限制，因为是对用户更有利的新低价）
    //  - 冷却期满（同一价格停留超过 cooldownHours，再做一次「仍在售」提醒）
    if (isNew || isCheaper || cooldownOk) {
      candidates.push(r);
      state[key] = { price: r.minPrice, discount: r.discountPct || 0, lastAlertAt: now, lastSeen: now, originCode: r.originCode, originCity: r.originCity };
    } else if (prev) {
      prev.lastSeen = now; // 仍在售，刷新见价时间（不重复推）
    }
  }

  // 清理长期未出现的航线
  for (const code of Object.keys(state)) {
    if (hoursSince((state[code].lastSeen) || state[code].lastAlertAt) >= 24 * SEEN_PRUNE_DAYS) delete state[code];
  }
  saveState(state);

  if (!candidates.length) {
    if (metThreshold > 0) {
      console.log(`✅ 本轮有 ${metThreshold} 条达到阈值，但均近期提醒过，不重复推。`);
    } else {
      const lowest = flights.routes.reduce((m, r) => Math.min(m, r.minPrice), Infinity);
      console.log(`✅ 本轮无航线达到提醒阈值（最低 ¥${lowest === Infinity ? '—' : lowest} > 阈值 ¥${maxPrice != null ? maxPrice : '—'}/折扣≥${minDiscount != null ? minDiscount : '—'}%），不推送。`);
    }
    return;
  }

  candidates.sort((a, b) => a.minPrice - b.minPrice);
  const lines = candidates.map(r => {
    const opt = r.options && r.options[0];
    const dur = opt ? tripDays(opt.depDate, opt.retDate) : '?';
    const seg = opt
      ? (opt.synthetic
          ? `${opt.depDate} 去 / ${opt.retDate} 回 · ${dur} 天（日历特价，具体航班接口限流）`
          : `${opt.depDate} 去 / ${opt.retDate} 回 · ${dur} 天 ${opt.out.flights.map(f => f.no).join('+')} ${opt.airlineNames.join('/')}${opt.direct ? ' 直飞' : ' 含中转'}`)
      : '';
    const from = r.originCity ? `【${r.originCity}】` : '';
    return `- ${from}**${r.city}(${r.code})** ¥${r.minPrice}（低于中位价 ${r.discountPct || 0}%）｜${seg}`;
  });

  const originSet = [...new Set(candidates.map(r => `${r.originCity || r.originCode}(${r.originCode})`))];
  const title = `🚨 实时特价 · ${candidates.length} 条新低价（${originSet.join('、')}）`;
  const desp = `命中触发条件（往返 ≤ ¥${maxPrice != null ? maxPrice : '—'} **或** 折扣 ≥ ${minDiscount != null ? minDiscount : '—'}%）的**新低价 / 更低价**航线：\n\n` +
    lines.join('\n') +
    `\n\n> 数据源 Trip.com，价格实时波动，以最终下单页为准。`;

  console.log('推送 ' + candidates.length + ' 条实时特价提醒…');
  const r = await push(SENDKEY, title, desp);
  if (r.ok) console.log('✅ 实时提醒推送成功');
  else { console.error('❌ 推送失败：', r.error); process.exitCode = 1; }
}

if (require.main === module) {
  main().catch((e) => { console.error('alert.js 异常：', e.message); process.exit(1); });
}
module.exports = { main };
