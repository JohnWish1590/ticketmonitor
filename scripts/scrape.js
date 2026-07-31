const fs = require('fs');
const path = require('path');
const api = require('./api');
const DESTS = require('./destinations');

const ROOT = path.resolve(__dirname, '..');
const WIN_START = '2026-07-31';
const WIN_END = '2026-08-20';
const ORIGIN = 'CAN';
const ORIGIN_TZ = 8;
// 行程时长（去程 -> 回程 的天数差），单位：天
const TRIP_MIN_DAYS = 5;
const TRIP_MAX_DAYS = 9;

function tripDays(dep, ret) {
  return Math.round((Date.parse(ret + 'T00:00:00Z') - Date.parse(dep + 'T00:00:00Z')) / 86400000);
}
function okDuration(dep, ret) {
  const d = tripDays(dep, ret);
  return d >= TRIP_MIN_DAYS && d <= TRIP_MAX_DAYS;
}

// 国内低成本（廉价）航空 —— 按要求排除
const LCC = new Set(['9C', 'AQ', 'PN', 'KN', '8L', 'DR', 'GJ', 'UQ', 'GY']);
const LCC_NAME = { '9C': '春秋航空', 'AQ': '九元航空', 'PN': '西部航空', 'KN': '中国联合航空', '8L': '祥鹏航空', 'DR': '瑞丽航空', 'GJ': '长龙航空', 'UQ': '乌鲁木齐航空', 'GY': '多彩贵州航空' };

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
  const res = await pool(DESTS, 6, async (d) => {
    const codes = [d.code, d.alt].filter(Boolean);
    for (const c of codes) {
      try {
        const pairs = await retry(() => api.lowPriceCalendar(ORIGIN, c, '2026-08-05', '2026-08-12'), 2);
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
  { dep: '2026-08-03', ret: '2026-08-09' },
  { dep: '2026-08-08', ret: '2026-08-15' },
  { dep: '2026-08-13', ret: '2026-08-19' },
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
function build(all, flightsByCode) {
  const rows = [];
  for (const r of all) {
    const groups = flightsByCode[r.code] || [];
    const options = [];
    let rawCount = 0, lccCount = 0;
    for (const g of groups) {
      for (const it of g.items) {
        rawCount++;
        if (it.hasLCC) { lccCount++; continue; }
        options.push({ ...it, depDate: g.dep, retDate: g.ret });
      }
    }
    if (!options.length) continue;
    // 同价同航班去重
    const seen = new Set();
    const uniq = options.filter(o => {
      const k = o.depDate + o.retDate + o.out.flights.map(f => f.no).join('/') + o.price;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a, b) => a.price - b.price);

    const best = uniq[0];
    const tier = best.price < 1000 ? 'A' : (best.price <= 2000 ? 'B' : null);
    if (!tier) continue;
    const cap = tier === 'A' ? 1000 : 2000;

    const calPrices = r.pairs.map(p => p.price);
    const medP = calPrices.length ? median(calPrices) : median(uniq.map(o => o.price));
    const maxP = calPrices.length ? Math.max(...calPrices) : Math.max(...uniq.map(o => o.price));

    rows.push({
      code: r.code, city: r.city, region: r.region, lat: r.lat, lng: r.lng, tz: r.tz,
      query: r.query || r.code,
      tier,
      minPrice: best.price,
      calMedian: medP, calMax: maxP,
      discountPct: medP > best.price ? Math.round((1 - best.price / medP) * 100) : 0,
      datePairsInBudget: r.pairs.filter(p => p.price <= cap).length,
      totalPairs: r.pairs.length,
      optionCount: uniq.filter(o => o.price <= cap).length,
      lccFiltered: lccCount,
      cheapestPairs: [...r.pairs].sort((a, b) => a.price - b.price).slice(0, 10),
      options: uniq.slice(0, 10),
    });
  }
  return rows;
}

// Stage 2.5：对「有希望跌破 1000」的航线加采样
async function stage25(all, byCode) {
  const extra = [];
  for (const r of all) {
    if (!r.pairs.length) continue;
    const got = (byCode[r.code] || []);
    const best = Math.min(...got.flatMap(g => g.items.filter(i => !i.hasLCC).map(i => i.price)).concat([99999]));
    if (best <= 1000 || best > 1500) continue;
    if (median(r.pairs.map(p => p.price)) > 1250) continue;
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
  const { withCal, noCal } = await stage1();
  let flights = await stage2(withCal, noCal);
  flights = await stage25([...withCal, ...noCal], flights);
  const rows = build([...withCal, ...noCal], flights);
  rows.sort((a, b) => a.minPrice - b.minPrice);
  console.log('[3/3] 生成数据文件 ...');
  const payload = {
    generatedAt: new Date().toISOString(),
    origin: { code: 'CAN', city: '广州', lat: 23.1291, lng: 113.2644 },
    window: { start: WIN_START, end: WIN_END },
    tripDuration: { min: TRIP_MIN_DAYS, max: TRIP_MAX_DAYS },
    excludedAirlines: [...LCC].map(c => ({ code: c, name: LCC_NAME[c] })),
    routes: rows,
  };
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'flights.json'), JSON.stringify(payload));
  console.log('[完成] 命中航线 ' + rows.length + '，耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  console.log('  A档(<¥1000): ' + rows.filter(r => r.tier === 'A').length + ' 条 | B档(¥1000-2000): ' + rows.filter(r => r.tier === 'B').length + ' 条');
})();
