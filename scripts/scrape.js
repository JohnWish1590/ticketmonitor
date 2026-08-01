const fs = require('fs');
const path = require('path');
const api = require('./api');

const ROOT = path.resolve(__dirname, '..');

// ---- 读取 config.json（由设置页面 `npm run settings` 维护）----
function loadConfig() {
  const p = path.join(ROOT, 'config.json');
  if (!fs.existsSync(p)) {
    throw new Error('缺少 config.json：请在 GitHub Pages 设置页（settings.html）保存一次，或复制 config.example.json 为 config.json');
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const CONFIG = loadConfig();

// 监控目的地：config.destinations 若配置则用之（设置页勾选），否则回退默认全量清单
const DESTS = (CONFIG.destinations && Array.isArray(CONFIG.destinations) && CONFIG.destinations.length)
  ? CONFIG.destinations
  : require('./destinations');

// 多出发地：origins 数组（设置页多出发地列表）；兼容旧版单 origin 对象
function resolveOrigins() {
  if (Array.isArray(CONFIG.origins) && CONFIG.origins.length) return CONFIG.origins;
  if (CONFIG.origin && CONFIG.origin.code) return [CONFIG.origin];
  return [];
}
const ORIGINS = resolveOrigins();
if (!ORIGINS.length) throw new Error('config 缺少出发地：请在设置页「出发地」至少添加一个（或保留 origin 字段）');
let WIN_START = CONFIG.window.start;
let WIN_END = CONFIG.window.end;
// 窗口自动前移：若起始日已过期，整体平移到「明天起」保持原跨度，避免展示过期日期
(() => {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const startDt = new Date(WIN_START + 'T00:00:00Z');
  const span = Math.max(1, Math.round((Date.parse(WIN_END) - Date.parse(WIN_START)) / 86400000) || 20);
  if (isNaN(startDt) || startDt < today) {
    const ns = new Date(today); ns.setUTCDate(ns.getUTCDate() + 1);
    WIN_START = ns.toISOString().slice(0, 10);
    const ne = new Date(ns); ne.setUTCDate(ne.getUTCDate() + span);
    WIN_END = ne.toISOString().slice(0, 10);
    console.log('[窗口] 原窗口已过，自动前移为 ' + WIN_START + ' ~ ' + WIN_END);
  }
})();
// 多出发地：ORIGIN/ORIGIN_TZ 在下方 main 循环中按当前出发地赋值
let ORIGIN = ORIGINS[0] ? ORIGINS[0].code : '';
let ORIGIN_TZ = ORIGINS[0] ? ORIGINS[0].tz : 8;
const TRIP_MIN_DAYS = CONFIG.tripMinDays;
const TRIP_MAX_DAYS = CONFIG.tripMaxDays;
const TIER_A = CONFIG.tierA;
const TIER_B = CONFIG.tierB;

function tripDays(dep, ret) {
  return Math.round((Date.parse(ret + 'T00:00:00Z') - Date.parse(dep + 'T00:00:00Z')) / 86400000);
}
function okDuration(dep, ret) {
  const d = tripDays(dep, ret);
  return d >= TRIP_MIN_DAYS && d <= TRIP_MAX_DAYS;
}

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 国内低成本（廉价）航空代码 -> 名称（名称固定；是否排除由 config.excludeCarriers 决定）
const LCC_NAME = { '9C': '春秋航空', 'AQ': '九元航空', 'PN': '西部航空', 'KN': '中国联合航空', '8L': '祥鹏航空', 'DR': '瑞丽航空', 'GJ': '长龙航空', 'UQ': '乌鲁木齐航空', 'GY': '多彩贵州航空' };
const LCC = new Set((CONFIG.excludeCarriers || []).filter(c => LCC_NAME[c]));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); }
      catch (e) { out[k] = { __error: e.message }; }
    }
  }));
  return out;
}

async function retry(fn, times = 3, gap = 1200) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(gap * (i + 1)); }
  }
  throw last;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function fmtLocal(ms, tzHours) {
  const d = new Date(ms + tzHours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

// ================= Stage 1：低价日历 =================
async function stage1() {
  console.log('[1/3] 扫描 ' + DESTS.length + ' 条航线的往返低价日历 ...');
  const res = await pool(DESTS, 4, async (d) => {
    await sleep(150);
    const codes = [d.code, d.alt].filter(Boolean);
    for (const c of codes) {
      try {
        const pairs = await retry(() => api.lowPriceCalendar(ORIGIN, c, WIN_START, WIN_END), 3, 1500);
        const valid = pairs.filter(p => p.dep >= WIN_START && p.dep <= WIN_END && p.ret >= p.dep && p.ret <= WIN_END && okDuration(p.dep, p.ret));
        if (valid.length) return { ...d, query: c, pairs: valid };
      } catch (e) { /* try next */ }
    }
    return { ...d, query: d.alt || d.code, pairs: [] };
  });
  const withCal = res.filter(r => r.pairs.length);
  const noCal = res.filter(r => !r.pairs.length);
  console.log('    有日历数据 ' + withCal.length + ' 条，需回退查询 ' + noCal.length + ' 条');
  return { withCal, noCal };
}

// ================= 解析航班 =================
function parseReturnLeg(shortPolicyId) {
  // ...^CAN,BKK,2026-08-05|BKK,CAN,2026-08-12;1;1,1,1,TG679,1,1785935100000|2,1,1,TG678,1,1786525200000
  if (!shortPolicyId) return null;
  const parts = shortPolicyId.split('^');
  const tail = parts[parts.length - 1];
  const seg = tail.split(';');
  if (seg.length < 3) return null;
  const legs = seg[seg.length - 1].split('|').map(s => s.split(','));
  const back = legs.filter(a => a[0] === '2');
  if (!back.length) return null;
  return back.map(a => ({ no: a[3], ts: Number(a[5]) })).filter(x => x.no && x.ts)
    .sort((x, y) => x.ts - y.ts);
}

function parseItineraries(data, tz) {
  const airlineMap = {};
  (data.airlineList || []).forEach(a => { if (a.code) airlineMap[a.code] = a.name; });
  const out = [];
  for (const it of (data.itineraryList || [])) {
    const j = (it.journeyList || [])[0];
    const pol = (it.policies || [])[0];
    if (!j || !pol || !pol.price) continue;
    const price = pol.price.totalPrice || pol.price.averagePrice;
    if (!price) continue;
    const secs = (j.transSectionList || []).filter(s => s.transportType === 'FLIGHT');
    if (!secs.length) continue;

    const outLeg = {
      dep: secs[0].departDateTime, arr: secs[secs.length - 1].arriveDateTime,
      stops: secs.length - 1, duration: j.duration,
      flights: secs.map(s => ({
        no: s.flightInfo.flightNo, al: s.flightInfo.airlineCode,
        craft: ((s.flightInfo.craftInfo || {}).shortName) || '',
        from: s.departPoint.cityName, fromT: s.departPoint.terminal || '',
        to: s.arrivePoint.cityName, toT: s.arrivePoint.terminal || '',
        depT: s.departDateTime, arrT: s.arriveDateTime,
      })),
    };
    const backRaw = parseReturnLeg(pol.shortPolicyId);
    const backLeg = backRaw ? {
      stops: backRaw.length - 1,
      flights: backRaw.map((b, i) => ({
        no: b.no, al: b.no.slice(0, 2).toUpperCase(),
        depT: fmtLocal(b.ts, i === 0 ? tz : ORIGIN_TZ),
      })),
    } : null;

    const codes = [...new Set([
      ...outLeg.flights.map(f => f.al),
      ...(backLeg ? backLeg.flights.map(f => f.al) : []),
    ])];
    const bag = (pol.tagList || []).some(t => t.key === 'FREE_CHECKED_BAGGAGE');
    out.push({
      price, airlines: codes,
      airlineNames: codes.map(c => airlineMap[c] || c),
      hasLCC: codes.some(c => LCC.has(c)),
      lccNames: codes.filter(c => LCC.has(c)).map(c => LCC_NAME[c] || c),
      direct: outLeg.stops === 0 && (!backLeg || backLeg.stops === 0),
      bag,
      out: outLeg, back: backLeg,
    });
  }
  return out;
}

// ================= Stage 2：具体航班 =================
function pickDates(route) {
  const sorted = [...route.pairs].sort((a, b) => a.price - b.price);
  const minP = sorted[0] ? sorted[0].price : 9999;
  // 便宜航线多采样，贵的少采样
  const quota = minP < 900 ? 6 : minP < 1500 ? 5 : minP < 2200 ? 3 : 2;
  const picks = []; const usedDep = new Map(); const seen = new Set();
  for (const p of sorted) {
    if (picks.length >= quota) break;
    const k = p.dep + p.ret;
    if (seen.has(k)) continue;
    // 保证出发日多样性：同一出发日最多取 2 组
    const c = usedDep.get(p.dep) || 0;
    if (c >= 2) continue;
    usedDep.set(p.dep, c + 1);
    seen.add(k); picks.push(p);
  }
  return picks;
}

const FALLBACK_DATES = [
  { dep: addDays(WIN_START, 3), ret: addDays(WIN_START, 9) },
  { dep: addDays(WIN_START, 8), ret: addDays(WIN_START, 15) },
  { dep: addDays(WIN_START, 13), ret: addDays(WIN_START, 19) },
];

async function stage2(withCal, noCal) {
  const jobs = [];
  for (const r of withCal) for (const p of pickDates(r)) jobs.push({ r, p });
  for (const r of noCal) for (const p of FALLBACK_DATES) jobs.push({ r, p });
  console.log('[2/3] 查询 ' + jobs.length + ' 组具体航班（并发 8）...');
  let done = 0;
  const res = await pool(jobs, 8, async (j) => {
    const code = j.r.query || j.r.code;
    const data = await retry(() => api.flightList(ORIGIN, code, j.p.dep, j.p.ret), 2, 2000);
    done++;
    if (done % 40 === 0) console.log('    进度 ' + done + '/' + jobs.length);
    return { key: j.r.code, dep: j.p.dep, ret: j.p.ret, items: parseItineraries(data, j.r.tz) };
  });
  const byCode = {};
  res.forEach(x => { if (x && !x.__error && x.items) (byCode[x.key] = byCode[x.key] || []).push(x); });
  console.log('    完成 ' + done + '/' + jobs.length);
  return byCode;
}

// ================= 汇总 =================
// 汇总：以「低价日历」为可靠主数据源（CI 中具体航班接口常被风控限流返回空），
// 具体航班详情（FlightListSearch）作为可选增强；缺失时退化为日历最优日期组合。
function build(all, flightsByCode) {
  const rows = [];
  for (const r of all) {
    const calPrices = (r.pairs || []).map(p => p.price);
    const hasCal = calPrices.length > 0;

    // 具体航班（可能因限流缺失）
    const groups = flightsByCode[r.code] || [];
    let rawCount = 0, lccCount = 0; const opts = [];
    for (const g of groups) for (const it of g.items) {
      rawCount++;
      if (it.hasLCC) { lccCount++; continue; }
      opts.push({ ...it, depDate: g.dep, retDate: g.ret });
    }
    const seen = new Set();
    const uniq = opts.filter(o => {
      const k = o.depDate + o.retDate + o.out.flights.map(f => f.no).join('/') + o.price;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a, b) => a.price - b.price);

    const optMin = uniq.length ? uniq[0].price : Infinity;
    if (!hasCal && !uniq.length) continue;            // 彻底无数据则跳过

    let minPrice, medP, maxP, discountPct;
    if (hasCal) {
      minPrice = Math.min(Math.min(...calPrices), optMin);
      medP = median(calPrices);
      maxP = Math.max(...calPrices);
      discountPct = medP > minPrice ? Math.round((1 - minPrice / medP) * 100) : 0;
    } else {
      minPrice = optMin; medP = optMin; maxP = optMin; discountPct = 0;
    }

    const tier = minPrice < TIER_A ? 'A' : (minPrice <= TIER_B ? 'B' : null);
    if (!tier) continue;
    const cap = tier === 'A' ? TIER_A : TIER_B;

    const datePairsInBudget = hasCal ? r.pairs.filter(p => p.price <= cap).length : 0;
    const totalPairs = hasCal ? r.pairs.length : 0;
    const optionCount = uniq.filter(o => o.price <= cap).length;

    const bestPair = hasCal ? [...r.pairs].sort((a, b) => a.price - b.price)[0] : null;
    const displayOptions = uniq.length ? uniq.slice(0, 10) : [{
      price: minPrice,
      depDate: bestPair ? bestPair.dep : (uniq[0] ? uniq[0].depDate : ''),
      retDate: bestPair ? bestPair.ret : (uniq[0] ? uniq[0].retDate : ''),
      airlines: [], airlineNames: [], direct: null, bag: null,
      out: { flights: [], depT: '', arrT: '', stops: null, duration: '' }, back: null,
      synthetic: true,
    }];

    rows.push({
      code: r.code, city: r.city, region: r.region, lat: r.lat, lng: r.lng, tz: r.tz,
      query: r.query || r.code,
      tier,
      detailAvailable: uniq.length > 0,
      minPrice,
      calMedian: medP, calMax: maxP,
      discountPct,
      datePairsInBudget, totalPairs,
      optionCount,
      lccFiltered: lccCount,
      cheapestPairs: hasCal ? [...r.pairs].sort((a, b) => a.price - b.price).slice(0, 10) : [],
      options: displayOptions,
    });
  }
  return rows;
}

// Stage 2.5：对「有希望跌破 A 档阈值」的航线加采样
async function stage25(all, byCode) {
  const extra = [];
  for (const r of all) {
    if (!r.pairs.length) continue;
    const got = (byCode[r.code] || []);
    const best = Math.min(...got.flatMap(g => g.items.filter(i => !i.hasLCC).map(i => i.price)).concat([99999]));
    if (best <= TIER_A || best > TIER_A * 1.5) continue;
    if (median(r.pairs.map(p => p.price)) > TIER_A * 1.25) continue;
    const tried = new Set(got.map(g => g.dep + g.ret));
    const cands = [...r.pairs].sort((a, b) => a.price - b.price)
      .filter(p => !tried.has(p.dep + p.ret)).slice(0, 30);
    const usedDep = new Map(); const picks = [];
    for (const p of cands) {
      if (picks.length >= 6) break;
      const c = usedDep.get(p.dep) || 0; if (c >= 1) continue;
      usedDep.set(p.dep, c + 1); picks.push(p);
    }
    picks.forEach(p => extra.push({ r, p }));
  }
  if (!extra.length) return byCode;
  console.log('[2.5] 对 ' + new Set(extra.map(e => e.r.code)).size + ' 条潜力航线补采 ' + extra.length + ' 组 ...');
  const res = await pool(extra, 8, async (j) => {
    const data = await retry(() => api.flightList(ORIGIN, j.r.query || j.r.code, j.p.dep, j.p.ret), 2, 1500);
    return { key: j.r.code, dep: j.p.dep, ret: j.p.ret, items: parseItineraries(data, j.r.tz) };
  });
  res.forEach(x => { if (x && !x.__error && x.items) (byCode[x.key] = byCode[x.key] || []).push(x); });
  return byCode;
}

(async () => {
  const t0 = Date.now();
  const allRows = [];
  for (const O of ORIGINS) {
    ORIGIN = O.code; ORIGIN_TZ = O.tz;
    console.log('=== 出发地 ' + (O.city || O.code) + ' (' + O.code + ') ===');
    const { withCal, noCal } = await stage1();
    let flights = await stage2(withCal, noCal);
    flights = await stage25([...withCal, ...noCal], flights);
    const rows = build([...withCal, ...noCal], flights);
    rows.forEach(r => { r.originCode = O.code; r.originCity = O.city; });
    allRows.push(...rows);
  }
  allRows.sort((a, b) => a.minPrice - b.minPrice);
  console.log('[3/3] 生成数据文件 ...');
  const payload = {
    generatedAt: new Date().toISOString(),
    origins: ORIGINS.map(o => ({ code: o.code, city: o.city, lat: o.lat, lng: o.lng, tz: o.tz })),
    window: { start: WIN_START, end: WIN_END },
    tripDuration: { min: TRIP_MIN_DAYS, max: TRIP_MAX_DAYS },
    tiers: { a: TIER_A, b: TIER_B },
    excludedAirlines: [...LCC].map(c => ({ code: c, name: LCC_NAME[c] })),
    routes: allRows,
  };
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'flights.json'), JSON.stringify(payload));
  console.log('[完成] 命中航线 ' + allRows.length + '，耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  const aN = allRows.filter(r => r.tier === 'A').length, bN = allRows.filter(r => r.tier === 'B').length;
  console.log('  A档(<¥' + TIER_A + '): ' + aN + ' 条 | B档(¥' + TIER_A + '-' + TIER_B + '): ' + bN + ' 条');
})();
