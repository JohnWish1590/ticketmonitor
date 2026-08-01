// 天气模块：为所有命中航线的目的地抓取 7/31 - 8/31 逐日天气
// 数据源：Open-Meteo
//   - 近期（约 16 天）：逐日数值预报 https://open-meteo.com/en/docs
//   - 远期：ERA5 历史再分析近 5 年同期气候常态 https://open-meteo.com/en/docs/historical-weather-api
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WIN_START = '2026-07-31';
const WIN_END = '2026-08-31';
const CLIMO_YEARS = [2021, 2022, 2023, 2024, 2025];

// 降雨判定阈值（当日累计降水，mm）
const RAIN_MM = 1.0;      // >= 1mm 视为「下雨」
const DRIZZLE_MM = 0.1;   // 0.1~1mm 视为「零星小雨」

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 40000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { last = e; await sleep(1200 * (i + 1)); }
  }
  throw last;
}

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

function dateRange(a, b) {
  const out = [];
  for (let t = Date.parse(a + 'T00:00:00Z'); t <= Date.parse(b + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// WMO weathercode -> 简述
function wmoText(c) {
  if (c === 0) return '晴';
  if (c === 1) return '晴间多云';
  if (c === 2) return '多云';
  if (c === 3) return '阴';
  if (c === 45 || c === 48) return '雾';
  if (c >= 51 && c <= 57) return '毛毛雨';
  if (c >= 61 && c <= 65) return '雨';
  if (c >= 66 && c <= 67) return '冻雨';
  if (c >= 71 && c <= 77) return '雪';
  if (c >= 80 && c <= 82) return '阵雨';
  if (c >= 85 && c <= 86) return '阵雪';
  if (c >= 95) return '雷雨';
  return '—';
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

// ---------- 预报（逐日数值预报，未来约 16 天） ----------
async function fetchForecast(city) {
  const u = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + city.lat + '&longitude=' + city.lng
    + '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,windspeed_10m_max'
    + '&timezone=auto&forecast_days=16';
  const j = await getJSON(u);
  const d = j.daily || {};
  const map = {};
  (d.time || []).forEach((day, i) => {
    map[day] = {
      date: day,
      src: 'forecast',
      code: d.weathercode[i],
      text: wmoText(d.weathercode[i]),
      tmax: d.temperature_2m_max[i],
      tmin: d.temperature_2m_min[i],
      prcp: d.precipitation_sum[i],
      pop: d.precipitation_probability_max[i],
      wind: d.windspeed_10m_max[i],
    };
  });
  return map;
}

// ---------- 气候常态（近 5 年同期 ERA5 再分析） ----------
async function fetchClimo(city, days) {
  if (!days.length) return {};
  const md = days.map(d => d.slice(5)); // MM-DD
  const first = md[0], last = md[md.length - 1];
  const byMd = {};
  md.forEach(m => byMd[m] = { prcp: [], tmax: [], tmin: [], wet: 0, n: 0 });

  for (const y of CLIMO_YEARS) {
    const u = 'https://archive-api.open-meteo.com/v1/archive'
      + '?latitude=' + city.lat + '&longitude=' + city.lng
      + '&start_date=' + y + '-' + first + '&end_date=' + y + '-' + last
      + '&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=auto';
    let j;
    try { j = await getJSON(u, 2); } catch (e) { continue; }
    const d = j.daily || {};
    (d.time || []).forEach((day, i) => {
      const key = day.slice(5);
      if (!byMd[key]) return;
      const p = d.precipitation_sum[i];
      if (p == null) return;
      byMd[key].prcp.push(p);
      if (d.temperature_2m_max[i] != null) byMd[key].tmax.push(d.temperature_2m_max[i]);
      if (d.temperature_2m_min[i] != null) byMd[key].tmin.push(d.temperature_2m_min[i]);
      byMd[key].n++;
      if (p >= RAIN_MM) byMd[key].wet++;
    });
    await sleep(120);
  }

  const out = {};
  days.forEach(day => {
    const b = byMd[day.slice(5)];
    if (!b || !b.n) return;
    const p = mean(b.prcp);
    const pop = Math.round(b.wet / b.n * 100);
    out[day] = {
      date: day,
      src: 'climatology',
      years: b.n,
      code: null,
      text: pop >= 60 ? '常年多雨' : pop >= 30 ? '可能有雨' : '常年少雨',
      tmax: b.tmax.length ? Math.round(mean(b.tmax) * 10) / 10 : null,
      tmin: b.tmin.length ? Math.round(mean(b.tmin) * 10) / 10 : null,
      prcp: Math.round(p * 10) / 10,
      pop,
      wind: null,
    };
  });
  return out;
}

// ---------- 统计 ----------
function summarize(days) {
  const list = days.filter(Boolean);
  const rain = list.filter(d => d.prcp >= RAIN_MM).length;
  const drizzle = list.filter(d => d.prcp >= DRIZZLE_MM && d.prcp < RAIN_MM).length;
  const dry = list.length - rain - drizzle;
  const heavy = list.filter(d => d.prcp >= 25).length;
  const tmaxs = list.map(d => d.tmax).filter(v => v != null);
  const tmins = list.map(d => d.tmin).filter(v => v != null);
  return {
    days: list.length,
    rainDays: rain,
    drizzleDays: drizzle,
    dryDays: dry,
    heavyDays: heavy,
    totalPrcp: Math.round(list.reduce((s, d) => s + (d.prcp || 0), 0) * 10) / 10,
    avgPop: list.length ? Math.round(mean(list.map(d => d.pop || 0))) : 0,
    tmax: tmaxs.length ? Math.round(Math.max(...tmaxs) * 10) / 10 : null,
    tmin: tmins.length ? Math.round(Math.min(...tmins) * 10) / 10 : null,
    dryRatio: list.length ? Math.round(dry / list.length * 100) : 0,
  };
}

// 干爽等级：dry(全程无雨) / mild(仅零星小雨) / wet(有雨) / heavy(多雨)
function grade(s) {
  if (s.rainDays === 0 && s.drizzleDays === 0) return 'dry';
  if (s.rainDays === 0) return 'mild';
  if (s.rainDays <= Math.max(1, Math.round(s.days * 0.25)) && s.heavyDays === 0) return 'wet';
  return 'heavy';
}

(async () => {
  const t0 = Date.now();
  const flights = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'flights.json'), 'utf8'));
  const originList = (Array.isArray(flights.origins) && flights.origins.length)
    ? flights.origins
    : (flights.origin ? [flights.origin] : []);
  const cities = [
    ...originList.map(o => ({ code: o.code, city: o.city, region: 'origin', lat: o.lat, lng: o.lng, isOrigin: true })),
    ...flights.routes.map(r => ({ code: r.code, city: r.city, region: r.region, lat: r.lat, lng: r.lng, tier: r.tier, minPrice: r.minPrice })),
  ];
  const allDays = dateRange(WIN_START, WIN_END);
  console.log('[天气] ' + cities.length + ' 个城市 × ' + allDays.length + ' 天（' + WIN_START + ' ~ ' + WIN_END + '）');

  console.log('[1/2] 抓取逐日数值预报 ...');
  const fcs = await pool(cities, 6, async (c) => await fetchForecast(c));

  // 预报未覆盖的日期 -> 气候常态
  const missing = [];
  fcs.forEach((f, i) => {
    if (!f || f.__error) { missing[i] = allDays; return; }
    missing[i] = allDays.filter(d => !f[d]);
  });
  const climoDays = missing.reduce((m, x) => Math.max(m, x.length), 0);
  console.log('[2/2] 抓取气候常态（近 ' + CLIMO_YEARS.length + ' 年同期），每城约 ' + climoDays + ' 天 ...');
  let done = 0;
  const clis = await pool(cities, 5, async (c, i) => {
    const r = await fetchClimo(c, missing[i]);
    done++;
    if (done % 10 === 0) console.log('    进度 ' + done + '/' + cities.length);
    return r;
  });

  const out = [];
  cities.forEach((c, i) => {
    const f = (fcs[i] && !fcs[i].__error) ? fcs[i] : {};
    const cl = (clis[i] && !clis[i].__error) ? clis[i] : {};
    const daily = allDays.map(d => f[d] || cl[d] || null).filter(Boolean);
    if (!daily.length) return;
    const s = summarize(daily);
    out.push({
      code: c.code, city: c.city, region: c.region, lat: c.lat, lng: c.lng,
      isOrigin: !!c.isOrigin, tier: c.tier || null, minPrice: c.minPrice || null,
      summary: s, grade: grade(s), daily,
    });
  });

  // 为每条航线的推荐行程区间单独评估
  const byCode = {};
  out.forEach(w => byCode[w.code] = w);
  const trips = [];
  for (const r of flights.routes) {
    const w = byCode[r.code];
    if (!w) continue;
    const o = r.options[0];
    const span = dateRange(o.depDate, o.retDate);
    const dl = span.map(d => w.daily.find(x => x.date === d)).filter(Boolean);
    if (!dl.length) continue;
    const s = summarize(dl);
    trips.push({
      code: r.code, city: r.city, region: r.region, lat: r.lat, lng: r.lng,
      tier: r.tier, minPrice: r.minPrice,
      dep: o.depDate, ret: o.retDate,
      summary: s, grade: grade(s),
      daily: dl,
    });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    window: { start: WIN_START, end: WIN_END },
    thresholds: { rainMm: RAIN_MM, drizzleMm: DRIZZLE_MM },
    climoYears: CLIMO_YEARS,
    sources: [
      { name: 'Open-Meteo 逐日数值预报', desc: '7/31 起约 16 天，ICON / GFS / ECMWF 集成', url: 'https://open-meteo.com/en/docs' },
      { name: 'Open-Meteo 历史天气 API（ERA5 再分析）', desc: '8/16 之后按近 5 年同期气候常态推算', url: 'https://open-meteo.com/en/docs/historical-weather-api' },
      { name: 'ECMWF ERA5 再分析数据集', desc: '气候常态原始数据来源', url: 'https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels' },
      { name: 'WMO 天气现象代码表', desc: '天气代码与文字描述对照', url: 'https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM' },
    ],
    cities: out,
    trips,
  };
  fs.writeFileSync(path.join(ROOT, 'data', 'weather.json'), JSON.stringify(payload));
  const g = (k) => trips.filter(t => t.grade === k).length;
  console.log('[完成] ' + out.length + ' 城，耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
  console.log('  行程区间：全程无雨 ' + g('dry') + ' | 仅零星小雨 ' + g('mild') + ' | 有雨 ' + g('wet') + ' | 多雨 ' + g('heavy'));
})();
