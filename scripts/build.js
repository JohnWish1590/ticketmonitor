const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'flights.json'), 'utf8'));

// 航司名称补全 / 清洗
const AL = {
  '5J': '宿务太平洋', 'AK': '亚航', 'FD': '泰国亚航', 'D7': '亚航X', 'TR': '酷航', 'VJ': '越捷航空',
  'VZ': '泰越捷', 'SL': '泰国狮航', 'JT': '狮子航空', 'QZ': '印尼亚航', 'Z2': '菲亚航', 'MM': '乐桃航空',
  'JW': '真航空', 'TW': '德威航空', 'LJ': '济州航空', '7C': '济州航空', 'BX': '釜山航空', 'RS': '首尔航空',
  'HX': '中国香港航空', 'UO': '中国香港快运', 'CX': '国泰航空', 'KA': '国泰港龙', 'NX': '澳门航空',
  'CI': '中华航空', 'BR': '长荣航空', 'JX': '星宇航空', 'CA': '中国国航', 'MU': '东方航空', 'CZ': '南方航空',
  'HU': '海南航空', 'ZH': '深圳航空', 'MF': '厦门航空', '3U': '四川航空', 'SC': '山东航空', 'FM': '上海航空',
  'HO': '吉祥航空', 'JD': '首都航空', 'GS': '天津航空', 'NS': '河北航空', 'G5': '华夏航空', 'EU': '成都航空',
  'TV': '西藏航空', 'PN': '西部航空', 'KY': '昆明航空', 'DZ': '东海航空', 'BK': '奥凯航空', 'JR': '幸福航空',
  'VN': '越南航空', 'TG': '泰国航空', 'SQ': '新加坡航空', 'MH': '马来西亚航空', 'GA': '印尼鹰航',
  'PR': '菲律宾航空', 'KE': '大韩航空', 'OZ': '韩亚航空', 'NH': '全日空', 'JL': '日本航空',
  'EK': '阿联酋航空', 'QR': '卡塔尔航空', 'EY': '阿提哈德', 'TK': '土耳其航空', 'SU': '俄航',
  'AI': '印度航空', 'UL': '斯里兰卡航空', 'KC': '阿斯塔纳航空', 'HY': '乌兹别克航空', 'OM': '蒙古航空',
  'QV': '老挝航空', 'K6': '柬埔寨吴哥航空', 'KR': '柬埔寨航空', 'MI': '胜安航空', 'BI': '文莱皇家航空',
};
function cleanName(n, code) {
  if (!n || /^[A-Z0-9]{2}$/.test(n)) return AL[code] || n || code;
  return String(n).split(/[|｜]/).pop().trim();
}
for (const r of data.routes) {
  for (const o of r.options) {
    o.airlineNames = o.airlines.map((c, i) => cleanName(o.airlineNames[i], c));
  }
}
const leafletJs = fs.readFileSync(path.join(ROOT, 'vendor', 'leaflet.js'), 'utf8');
const leafletCss = fs.readFileSync(path.join(ROOT, 'vendor', 'leaflet.css'), 'utf8');

// ---------- 天气数据（按出行窗口重新分档） ----------
const wraw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'weather.json'), 'utf8'));
function wgrade(s) {
  if (s.heavyDays === 0 && s.dryDays >= 3) return 'dry';      // 干爽少雨（无强降雨、≥3 个晴日）
  if (s.heavyDays === 0 && s.dryDays >= 1) return 'mild';     // 偶有阵雨（无强降雨）
  if (s.heavyDays >= 3) return 'heavy';                        // 强降雨频繁
  return 'wet';                                                // 多雨
}
const WLABEL = { dry: '干爽少雨', mild: '偶有阵雨', wet: '多雨', heavy: '强降雨频繁' };
const WDESC = {
  dry: '出行窗口内少雨、无强降雨，最值得优先安排',
  mild: '偶有阵雨但无强降雨，备好雨具即可',
  wet: '降雨较多，强降雨日 ≤2，出行需留意',
  heavy: '强降雨频繁（≥3 个暴雨日），谨慎选择',
};
wraw.trips.forEach(t => { t.grade = wgrade(t.summary); });
const wByCode = {}; wraw.trips.forEach(t => { wByCode[t.code] = t; });
// 给航线附加天气摘要，便于机票列表显示天气徽标
for (const r of data.routes) {
  const w = wByCode[r.code];
  if (w) r.weather = { grade: w.grade, dep: w.dep, ret: w.ret, dryDays: w.summary.dryDays, days: w.summary.days, avgPop: w.summary.avgPop, heavyDays: w.summary.heavyDays, tmax: w.summary.tmax, tmin: w.summary.tmin };
}
const weatherPayload = {
  window: wraw.window,
  generatedAt: wraw.generatedAt,
  sources: wraw.sources,
  cities: wraw.cities,
  trips: wraw.trips,
  gradeCounts: {},
};
wraw.trips.forEach(t => { weatherPayload.gradeCounts[t.grade] = (weatherPayload.gradeCounts[t.grade] || 0) + 1; });

// ---------- 计算推荐 ----------
function picks(rows, tier) {
  const list = rows.filter(r => r.tier === tier);
  if (!list.length) return null;
  const used = new Set();
  const take = (cmp) => {
    const s = [...list].sort(cmp);
    return (s.find(r => !used.has(r.code)) || s[0]);
  };
  const cheapest = take((a, b) => a.minPrice - b.minPrice); used.add(cheapest.code);
  const discount = take((a, b) => b.discountPct - a.discountPct || a.minPrice - b.minPrice); used.add(discount.code);
  const most = take((a, b) => b.optionCount - a.optionCount || b.datePairsInBudget - a.datePairsInBudget || a.minPrice - b.minPrice);
  return { cheapest, discount, most };
}
const P = { A: picks(data.routes, 'A'), B: picks(data.routes, 'B') };

const genTime = new Date(new Date(data.generatedAt).getTime() + 8 * 3600 * 1000)
  .toISOString().replace('T', ' ').slice(0, 16);

const payload = {
  generatedAt: data.generatedAt,
  genTime,
  origin: data.origin,
  window: data.window,
  excludedAirlines: data.excludedAirlines,
  routes: data.routes,
  picks: {
    A: P.A ? { cheapest: P.A.cheapest.code, discount: P.A.discount.code, most: P.A.most.code } : null,
    B: P.B ? { cheapest: P.B.cheapest.code, discount: P.B.discount.code, most: P.B.most.code } : null,
  },
  weather: weatherPayload,
};

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>广州出发 · 往返机票监控 (7/31 - 8/20)</title>
<style>${leafletCss}</style>
<style>
:root{
  --bg:#f5f6f8; --panel:#ffffff; --line:#e4e7ec; --line2:#eef0f3;
  --tx:#1b1f26; --tx2:#5c6470; --tx3:#8b93a1;
  --red:#e02b3c; --red-soft:#fdecee;
  --amber:#e08a1e; --amber-soft:#fdf3e4;
  --blue:#2563d9; --blue-soft:#eaf0fd;
  --green:#0f9960;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
  background:var(--bg);color:var(--tx);font-size:13px;line-height:1.5}
.wrap{max-width:1680px;margin:0 auto;padding:14px 16px 24px}

/* ---- header ---- */
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:12px}
h1{font-size:19px;font-weight:700;letter-spacing:-.2px}
h1 small{font-weight:500;font-size:12px;color:var(--tx2);margin-left:8px}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--tx2)}
.pill{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:3px 11px;white-space:nowrap}
.pill b{color:var(--tx);font-weight:600}
.pill.warn{background:var(--amber-soft);border-color:#f3ddb8;color:#8a5b12}

/* ---- picks ---- */
.picks{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:12px}
@media(max-width:1400px){.picks{grid-template-columns:repeat(3,1fr)}}
@media(max-width:820px){.picks{grid-template-columns:repeat(2,1fr)}}
.pick{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px 12px;cursor:pointer;
  transition:.15s;position:relative;overflow:hidden}
.pick:hover{border-color:#c9d2e0;box-shadow:0 4px 14px rgba(20,30,50,.07);transform:translateY(-1px)}
.pick::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}
.pick.a::before{background:var(--red)}
.pick.b::before{background:var(--amber)}
.pick-hd{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--tx3);margin-bottom:5px;letter-spacing:.3px}
.tag{font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.tag.a{background:var(--red-soft);color:var(--red)}
.tag.b{background:var(--amber-soft);color:var(--amber)}
.pick-city{font-size:16px;font-weight:700;display:flex;align-items:baseline;gap:6px}
.pick-city span{font-size:10.5px;color:var(--tx3);font-weight:500}
.pick-price{font-size:20px;font-weight:700;color:var(--red);margin:2px 0 3px;font-variant-numeric:tabular-nums}
.pick-price small{font-size:11px;font-weight:500;color:var(--tx2)}
.pick-sub{font-size:11px;color:var(--tx2);line-height:1.45}
.pick-sub em{font-style:normal;color:var(--green);font-weight:600}

/* ---- main ---- */
.main{display:grid;grid-template-columns:1fr 460px;gap:12px;height:calc(100vh - 40px);min-height:640px}
@media(max-width:1100px){.main{grid-template-columns:1fr;height:auto}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
#map{width:100%;height:100%;min-height:520px;background:#e8eef4}
.map-legend{position:absolute;right:12px;bottom:22px;z-index:500;background:rgba(255,255,255,.94);
  border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.map-legend div{display:flex;align-items:center;gap:6px;margin:2px 0}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.map-wrap{position:relative;height:100%}

/* ---- list ---- */
.list-hd{padding:10px 12px;border-bottom:1px solid var(--line2);display:flex;flex-direction:column;gap:8px}
.tabs{display:flex;gap:6px}
.tab{flex:1;text-align:center;padding:6px 4px;border:1px solid var(--line);border-radius:7px;cursor:pointer;
  font-size:12px;font-weight:600;color:var(--tx2);background:#fafbfc;transition:.12s;white-space:nowrap}
.tab:hover{border-color:#c9d2e0}
.tab.on{background:var(--tx);color:#fff;border-color:var(--tx)}
.tab.on.a{background:var(--red);border-color:var(--red)}
.tab.on.b{background:var(--amber);border-color:var(--amber)}
.row2{display:flex;gap:6px;align-items:center}
select,input[type=text]{border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12px;
  background:#fff;color:var(--tx);outline:none;font-family:inherit}
select:focus,input:focus{border-color:var(--blue)}
input[type=text]{flex:1}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{font-size:11px;padding:3px 9px;border-radius:14px;border:1px solid var(--line);cursor:pointer;
  background:#fafbfc;color:var(--tx2);transition:.12s}
.chip:hover{border-color:#c9d2e0}
.chip.on{background:var(--blue-soft);border-color:#b9cdf5;color:var(--blue);font-weight:600}
.count{font-size:11px;color:var(--tx3);padding:0 2px}

#list{overflow-y:auto;flex:1;padding:8px}
#list::-webkit-scrollbar{width:8px}
#list::-webkit-scrollbar-thumb{background:#d3d8e0;border-radius:4px}
.item{border:1px solid var(--line);border-radius:9px;padding:9px 10px;margin-bottom:7px;cursor:pointer;transition:.13s;background:#fff}
.item:hover{border-color:#c3cddd;box-shadow:0 2px 10px rgba(20,30,50,.06)}
.item.sel{border-color:var(--blue);box-shadow:0 0 0 2px var(--blue-soft)}
.it-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.it-city{font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:5px}
.it-city .code{font-size:10px;color:var(--tx3);font-weight:500;background:#f2f4f7;padding:1px 5px;border-radius:4px}
.it-price{font-size:17px;font-weight:700;color:var(--red);font-variant-numeric:tabular-nums;white-space:nowrap}
.it-price small{font-size:10.5px;font-weight:500;color:var(--tx3);display:block;text-align:right}
.it-line{font-size:11.5px;color:var(--tx2);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.badge{font-size:10px;padding:1px 6px;border-radius:4px;background:#f2f4f7;color:var(--tx2)}
.badge.g{background:#e7f6ee;color:var(--green)}
.badge.r{background:var(--red-soft);color:var(--red)}
.badge.b{background:var(--blue-soft);color:var(--blue)}
.legs{margin-top:7px;border-top:1px dashed var(--line);padding-top:6px;display:none}
.item.open .legs{display:block}
.leg{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;margin:3px 0}
.leg .dir{flex:0 0 30px;color:var(--tx3);font-size:10px;padding-top:1px}
.leg .body{flex:1;color:var(--tx)}
.leg .fno{font-weight:600;color:var(--blue)}
.leg .t{font-variant-numeric:tabular-nums}
.alts{margin-top:6px;font-size:11px;color:var(--tx2)}
.alts table{width:100%;border-collapse:collapse}
.alts td{padding:2px 4px;border-top:1px solid var(--line2)}
.alts td:last-child{text-align:right;font-weight:600;color:var(--red);font-variant-numeric:tabular-nums}
.empty{text-align:center;color:var(--tx3);padding:40px 10px;font-size:12.5px}
.foot{margin-top:10px;font-size:11px;color:var(--tx3);line-height:1.7}
.leaflet-container{font:inherit}
.mk{border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.3)}
.mk-lbl{background:rgba(255,255,255,.93);border:1px solid var(--line);border-radius:4px;padding:0 4px;
  font-size:10px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.12)}

/* ---- weather module ---- */
.sec{border-top:1px solid var(--line);margin-top:16px;padding-top:14px}
.sec-hd{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:10px}
.sec-hd h2{font-size:17px;font-weight:700;display:flex;align-items:center;gap:8px}
.sec-hd h2 small{font-weight:500;font-size:11.5px;color:var(--tx2)}
.wmain{display:grid;grid-template-columns:1fr 460px;gap:12px;height:calc(100vh - 60px);min-height:600px}
@media(max-width:1100px){.wmain{grid-template-columns:1fr;height:auto}}
#wmap{width:100%;height:100%;min-height:520px;background:#e8eef4}
.wlegend{position:absolute;left:12px;bottom:18px;z-index:500;background:rgba(255,255,255,.95);
  border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.wlegend b{display:block;margin-bottom:4px;font-size:11px;color:var(--tx2)}
.wlegend div{display:flex;align-items:center;gap:6px;margin:3px 0}
.wpanel{display:flex;flex-direction:column}
.wlist{overflow-y:auto;flex:1;padding:8px}
.wlist::-webkit-scrollbar{width:8px}.wlist::-webkit-scrollbar-thumb{background:#d3d8e0;border-radius:4px}
.wgroup-hd{font-size:11px;font-weight:700;color:var(--tx2);padding:8px 8px 4px;display:flex;align-items:center;gap:6px;position:sticky;top:0;background:#fff;z-index:2}
.wrow{border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-bottom:6px;cursor:pointer;transition:.13s;background:#fff}
.wrow:hover{border-color:#c3cddd;box-shadow:0 2px 10px rgba(20,30,50,.06)}
.wrow.sel{border-color:var(--blue);box-shadow:0 0 0 2px var(--blue-soft)}
.wr-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.wr-city{font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px}
.wr-city .code{font-size:10px;color:var(--tx3);font-weight:500;background:#f2f4f7;padding:1px 5px;border-radius:4px}
.wr-g{font-size:10px;padding:1px 7px;border-radius:4px;color:#fff;font-weight:600;white-space:nowrap}
.wr-sub{font-size:11px;color:var(--tx2);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}
.wr-sub b{color:var(--tx);font-weight:600}
.wfc{border-top:1px solid var(--line2);margin-top:7px;padding-top:6px;display:none}
.wrow.open .wfc{display:block}
.wfclist{display:flex;overflow-x:auto;gap:4px;padding-bottom:4px}
.wfcday{flex:0 0 auto;width:62px;border:1px solid var(--line2);border-radius:7px;padding:4px 3px;text-align:center;font-size:10px;background:#fafbfc}
.wfcday .d{color:var(--tx3);font-size:9.5px}
.wfcday .t{font-weight:700;font-size:11px}
.wfcday .p{font-size:9.5px;color:var(--blue)}
.wfcday .r{font-size:14px}
.wsrc{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.wsrc b{font-size:12px;display:block;margin-bottom:6px}
.wsrc a{color:var(--blue);text-decoration:none;font-size:11.5px;display:block;margin:3px 0;word-break:break-all}
.wsrc a:hover{text-decoration:underline}
.wsrc .sdesc{color:var(--tx3);font-size:10.5px}
.wtag{font-size:9.5px;padding:0 5px;border-radius:3px;background:#eef0f3;color:var(--tx3);margin-left:4px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>广州 (CAN) 出发 · 往返机票监控<small>单人往返含税总价 · 经济舱</small></h1>
      <div class="meta" style="margin-top:6px">
        <span class="pill">出行窗口 <b>2026-07-31 ~ 08-20</b></span>
        <span class="pill">行程时长 <b>5 ~ 9 天</b></span>
        <span class="pill">数据更新 <b>${genTime}</b></span>
        <span class="pill">命中航线 <b id="statAll">-</b></span>
        <span class="pill" style="background:var(--red-soft);border-color:#f6cdd2"><b id="statA">-</b> 条 &lt; ¥1000</span>
        <span class="pill" style="background:var(--amber-soft);border-color:#f3ddb8"><b id="statB">-</b> 条 ¥1000~2000</span>
        <span class="pill warn">已剔除春秋/九元等国内廉价航空</span>
      </div>
    </div>
  </header>

  <div class="picks" id="picks"></div>

  <div class="main">
    <div class="card"><div class="map-wrap">
      <div id="map"></div>
      <div class="map-legend">
        <div><span class="dot" style="background:#e02b3c"></span> 往返 &lt; ¥1000</div>
        <div><span class="dot" style="background:#e08a1e"></span> 往返 ¥1000 ~ ¥2000</div>
        <div style="color:#8b93a1;margin-top:3px">圆点越大＝可选航班/日期越多</div>
      </div>
    </div></div>

    <div class="card">
      <div class="list-hd">
        <div class="tabs">
          <div class="tab on" data-tier="all">全部</div>
          <div class="tab a" data-tier="A">&lt; ¥1000</div>
          <div class="tab b" data-tier="B">¥1000 ~ 2000</div>
        </div>
        <div class="row2">
          <select id="sort">
            <option value="price">按价格 ↑</option>
            <option value="discount">按折扣幅度 ↓</option>
            <option value="options">按可选航次 ↓</option>
            <option value="dates">按可选日期 ↓</option>
          </select>
          <input type="text" id="q" placeholder="搜索城市 / 三字码">
        </div>
        <div class="chips" id="regions"></div>
        <div class="count" id="cnt"></div>
      </div>
      <div id="list"></div>
    </div>
  </div>

  <section class="sec">
    <div class="sec-hd">
      <h2>☁️ 目的地天气预测<small>出行窗口内降雨分级 · 7/31–8/31 全程预报</small></h2>
      <div class="meta">
        <span class="pill">预测跨度 <b>${wraw.window.start} ~ ${wraw.window.end}</b></span>
        <span class="pill">出行窗口 5~9 天</span>
        <span class="pill" style="background:#e7f6ee;border-color:#bfe6cf"><b id="wgDry">-</b> 🟢 干爽</span>
        <span class="pill" style="background:var(--blue-soft);border-color:#b9cdf5"><b id="wgMild">-</b> 🔵 偶有阵雨</span>
        <span class="pill" style="background:var(--amber-soft);border-color:#f3ddb8"><b id="wgWet">-</b> 🟡 多雨</span>
        <span class="pill" style="background:var(--red-soft);border-color:#f6cdd2"><b id="wgHeavy">-</b> 🔴 强降雨</span>
      </div>
    </div>
    <div class="wmain">
      <div class="card"><div class="map-wrap">
        <div id="wmap"></div>
        <div class="wlegend">
          <b>出行窗口内降雨分级</b>
          <div><span class="dot" style="background:#0f9960"></span> 🟢 干爽少雨（无强降雨·≥3 晴日）</div>
          <div><span class="dot" style="background:#2563d9"></span> 🔵 偶有阵雨（无强降雨）</div>
          <div><span class="dot" style="background:#e08a1e"></span> 🟡 多雨</div>
          <div><span class="dot" style="background:#e02b3c"></span> 🔴 强降雨频繁（≥3 暴雨日）</div>
          <div style="color:#8b93a1;margin-top:4px">圆点越大＝晴日越多</div>
        </div>
      </div></div>
      <div class="card wpanel">
        <div class="list-hd"><div class="count" id="wcnt">点击地图或下方城市查看 7/31–8/31 全程预报</div></div>
        <div class="wlist" id="wlist"></div>
      </div>
    </div>
    <div class="wsrc" id="wsrc"></div>
  </section>

  <div class="foot">
    数据源：Trip.com 公开航班查询接口，价格为 1 名成人经济舱往返含税总价（人民币），实时波动，以最终下单页为准。<br>
    已排除的国内低成本航空：${data.excludedAirlines.map(a => a.name).join('、')}。折扣幅度＝该航线所选最低价相对窗口期内往返价格中位数的降幅。
  </div>
</div>

<script>${leafletJs}</script>
<script>
const DATA = ${JSON.stringify(payload)};
const REGION_NAME={domestic:'国内/港澳台',asia:'亚洲',oceania:'大洋洲',europe:'欧洲',america:'美洲',africa:'非洲'};
const PICK_LABEL={cheapest:'最便宜',discount:'折扣最大',most:'航次最多'};
const W={
  dry:{color:'#0f9960',bg:'#e7f6ee',label:'干爽少雨',desc:'出行窗口内少雨、无强降雨，最值得优先安排'},
  mild:{color:'#2563d9',bg:'#eaf0fd',label:'偶有阵雨',desc:'偶有阵雨但无强降雨，备好雨具即可'},
  wet:{color:'#e08a1e',bg:'#fdf3e4',label:'多雨',desc:'降雨较多，强降雨日≤2，出行需留意'},
  heavy:{color:'#e02b3c',bg:'#fdecee',label:'强降雨频繁',desc:'强降雨频繁（≥3 个暴雨日），谨慎选择'},
};
const wOrder=['dry','mild','wet','heavy'];
let state={tier:'all',sort:'price',q:'',regions:new Set(),sel:null};
function tripDays(a,b){return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);}
const byCode={}; DATA.routes.forEach(r=>byCode[r.code]=r);

/* ---------- 地图 ---------- */
const map=L.map('map',{zoomControl:true,worldCopyJump:true,minZoom:2}).setView([25,105],3);
L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  {subdomains:['1','2','3','4'],maxZoom:16,attribution:'&copy; 高德地图'}).addTo(map);
const O=DATA.origin;
L.circleMarker([O.lat,O.lng],{radius:7,color:'#fff',weight:2,fillColor:'#2563d9',fillOpacity:1}).addTo(map)
  .bindTooltip('广州 CAN · 出发地',{permanent:false});
const layer=L.layerGroup().addTo(map);
const lineLayer=L.layerGroup().addTo(map);
const markers={};

function radiusOf(r){ const n=r.optionCount+r.datePairsInBudget; return Math.max(5,Math.min(15,4+Math.sqrt(n)*1.5)); }
function colorOf(r){ return r.tier==='A'?'#e02b3c':'#e08a1e'; }

function drawMap(rows){
  layer.clearLayers(); lineLayer.clearLayers(); Object.keys(markers).forEach(k=>delete markers[k]);
  rows.forEach(r=>{
    const m=L.circleMarker([r.lat,r.lng],{radius:radiusOf(r),color:'#fff',weight:1.5,
      fillColor:colorOf(r),fillOpacity:.82,className:'mk'}).addTo(layer);
    m.bindTooltip('<b>'+r.city+'</b> ¥'+r.minPrice+'<br><span style="color:#666">'+r.options[0].depDate.slice(5)+' 去 / '+r.options[0].retDate.slice(5)+' 回</span>',
      {direction:'top',offset:[0,-4]});
    m.on('click',()=>select(r.code,true));
    markers[r.code]=m;
  });
}
function drawLine(r){
  lineLayer.clearLayers();
  if(!r) return;
  let lng=r.lng; if(lng-O.lng>180)lng-=360; if(O.lng-lng>180)lng+=360;
  const pts=[]; const n=48;
  for(let i=0;i<=n;i++){const t=i/n;
    const la=O.lat+(r.lat-O.lat)*t + Math.sin(Math.PI*t)*Math.min(18,Math.abs(lng-O.lng)/6+Math.abs(r.lat-O.lat)/6);
    pts.push([la,O.lng+(lng-O.lng)*t]);}
  L.polyline(pts,{color:colorOf(r),weight:2,opacity:.85,dashArray:'5,4'}).addTo(lineLayer);
}

/* ---------- 列表 ---------- */
function fmtLeg(o){
  const f=o.out.flights;
  const seg=f.map(x=>'<span class="fno">'+x.no+'</span> '+x.from+(x.fromT?'('+x.fromT+')':'')+' <span class="t">'+x.depT.slice(11,16)+'</span> → '+x.to+(x.toT?'('+x.toT+')':'')+' <span class="t">'+x.arrT.slice(11,16)+'</span>').join('<br>');
  const bk=o.back?o.back.flights.map(x=>'<span class="fno">'+x.no+'</span> <span class="t">'+x.depT+'</span> 起飞').join('<br>'):'—';
  const dur=o.out.duration?Math.floor(o.out.duration/60)+'h'+(o.out.duration%60?String(o.out.duration%60)+'m':''):'';
  return '<div class="leg"><div class="dir">去程</div><div class="body">'+seg+
    '<div style="color:#8b93a1;font-size:10.5px">'+o.depDate+' · '+(o.out.stops?o.out.stops+' 次中转':'直飞')+(dur?' · 全程 '+dur:'')+'</div></div></div>'+
    '<div class="leg"><div class="dir">回程</div><div class="body">'+bk+
    '<div style="color:#8b93a1;font-size:10.5px">'+o.retDate+' · 当地时间</div></div></div>';
}
function itemHTML(r){
  const o=r.options[0];
  const alts=r.cheapestPairs.slice(0,6).map(p=>'<tr><td>'+p.dep.slice(5)+' 去 · '+p.ret.slice(5)+' 回</td><td>¥'+p.price+'</td></tr>').join('');
  const others=r.options.slice(1,5).map(x=>'<tr><td>'+x.depDate.slice(5)+'/'+x.retDate.slice(5)+' '+x.out.flights.map(f=>f.no).join('+')+' '+x.airlineNames.join('/')+'</td><td>¥'+x.price+'</td></tr>').join('');
  return '<div class="item" data-code="'+r.code+'">'+
    '<div class="it-top"><div>'+
      '<div class="it-city">'+r.city+'<span class="code">'+r.code+'</span></div>'+
      '<div class="it-line">'+
        '<span>'+o.depDate.slice(5)+' 去 · '+o.retDate.slice(5)+' 回 · '+tripDays(o.depDate,o.retDate)+' 天</span>'+
        '<span class="badge '+(o.direct?'g':'')+'">'+(o.direct?'直飞往返':'含中转')+'</span>'+
        '<span class="badge">'+o.airlineNames.join(' / ')+'</span>'+
        (o.bag?'<span class="badge b">含托运</span>':'')+
      '</div>'+
      '<div class="it-line">'+
        (r.discountPct>0?'<span class="badge r">低于中位价 '+r.discountPct+'%</span>':'')+
        '<span class="badge">'+r.optionCount+' 个航次可选</span>'+
        (r.datePairsInBudget?'<span class="badge">'+r.datePairsInBudget+' 组日期在预算内</span>':'')+
        (r.weather?'<span class="badge" style="background:'+W[r.weather.grade].bg+';color:'+W[r.weather.grade].color+'">☁ '+W[r.weather.grade].label+' · 晴'+r.weather.dryDays+'/'+r.weather.days+'</span>':'')+
      '</div>'+
    '</div><div class="it-price">¥'+r.minPrice+'<small>往返/人</small></div></div>'+
    '<div class="legs">'+fmtLeg(o)+
      (others?'<div class="alts"><div style="color:#8b93a1;margin:5px 0 2px">同航线其他航班</div><table>'+others+'</table></div>':'')+
      (alts?'<div class="alts"><div style="color:#8b93a1;margin:5px 0 2px">窗口期内更多低价日期组合（含全部航司）</div><table>'+alts+'</table></div>':'')+
    '</div></div>';
}

function filtered(){
  let rows=DATA.routes.filter(r=>{
    if(state.tier!=='all'&&r.tier!==state.tier) return false;
    if(state.regions.size&&!state.regions.has(r.region)) return false;
    if(state.q){const q=state.q.toLowerCase(); if(!(r.city.toLowerCase().includes(q)||r.code.toLowerCase().includes(q))) return false;}
    return true;
  });
  const s=state.sort;
  rows.sort((a,b)=> s==='price'?a.minPrice-b.minPrice
    : s==='discount'?b.discountPct-a.discountPct||a.minPrice-b.minPrice
    : s==='options'?b.optionCount-a.optionCount||a.minPrice-b.minPrice
    : b.datePairsInBudget-a.datePairsInBudget||a.minPrice-b.minPrice);
  return rows;
}
function render(){
  const rows=filtered();
  document.getElementById('list').innerHTML= rows.length?rows.map(itemHTML).join(''):'<div class="empty">没有符合条件的航线</div>';
  document.getElementById('cnt').textContent='共 '+rows.length+' 条航线';
  drawMap(rows);
  document.querySelectorAll('.item').forEach(el=>{
    el.onclick=()=>{ const c=el.dataset.code; el.classList.toggle('open'); select(c,false); };
  });
  if(state.sel&&byCode[state.sel]) select(state.sel,false,true);
}
function select(code,fromMap,quiet){
  state.sel=code;
  document.querySelectorAll('.item').forEach(el=>el.classList.toggle('sel',el.dataset.code===code));
  const r=byCode[code]; drawLine(r);
  if(fromMap){
    const el=document.querySelector('.item[data-code="'+code+'"]');
    if(el){el.classList.add('open');el.scrollIntoView({behavior:'smooth',block:'center'});}
  }else if(!quiet&&r){ if(markers[code]) markers[code].openTooltip(); }
}

/* ---------- 推荐卡 ---------- */
function pickCard(tier,kind,code){
  const r=byCode[code]; if(!r) return '';
  const o=r.options[0];
  const extra= kind==='cheapest'?('最低往返 · '+(o.direct?'直飞':'含中转'))
    : kind==='discount'?('<em>低于中位价 '+r.discountPct+'%</em> · 中位 ¥'+r.calMedian)
    : ('<em>'+r.optionCount+' 个航次 / '+r.datePairsInBudget+' 组日期</em>');
  return '<div class="pick '+tier.toLowerCase()+'" data-code="'+code+'">'+
    '<div class="pick-hd"><span class="tag '+tier.toLowerCase()+'">'+(tier==='A'?'<¥1000':'¥1000-2000')+'</span>'+PICK_LABEL[kind]+'</div>'+
    '<div class="pick-city">'+r.city+'<span>'+r.code+'</span></div>'+
    '<div class="pick-price">¥'+r.minPrice+'<small> /人往返</small></div>'+
    '<div class="pick-sub">'+o.depDate.slice(5)+' 去 · '+o.retDate.slice(5)+' 回 · '+tripDays(o.depDate,o.retDate)+' 天<br>'+
      o.out.flights.map(f=>f.no).join('+')+' '+o.airlineNames.join('/')+'<br>'+extra+'</div></div>';
}
function renderPicks(){
  let h='';
  ['A','B'].forEach(t=>{ const p=DATA.picks[t]; if(!p) return;
    ['cheapest','discount','most'].forEach(k=>{ h+=pickCard(t,k,p[k]); }); });
  document.getElementById('picks').innerHTML=h;
  document.querySelectorAll('.pick').forEach(el=>{
    el.onclick=()=>{ const c=el.dataset.code; const r=byCode[c];
      state.tier='all'; state.regions.clear(); state.q=''; document.getElementById('q').value='';
      document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tier==='all'));
      document.querySelectorAll('.chip').forEach(t=>t.classList.remove('on'));
      render(); select(c,true); map.flyTo([r.lat,r.lng],4,{duration:.8}); };
  });
}

/* ---------- 控件 ---------- */
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on'); state.tier=t.dataset.tier; render(); });
document.getElementById('sort').onchange=e=>{state.sort=e.target.value;render();};
document.getElementById('q').oninput=e=>{state.q=e.target.value.trim();render();};
const regions=[...new Set(DATA.routes.map(r=>r.region))];
document.getElementById('regions').innerHTML=regions.map(r=>'<div class="chip" data-r="'+r+'">'+REGION_NAME[r]+' '+DATA.routes.filter(x=>x.region===r).length+'</div>').join('');
document.querySelectorAll('.chip').forEach(c=>c.onclick=()=>{
  const r=c.dataset.r; if(state.regions.has(r)){state.regions.delete(r);c.classList.remove('on');}
  else{state.regions.add(r);c.classList.add('on');} render(); });

document.getElementById('statAll').textContent=DATA.routes.length;
document.getElementById('statA').textContent=DATA.routes.filter(r=>r.tier==='A').length;
document.getElementById('statB').textContent=DATA.routes.filter(r=>r.tier==='B').length;
renderPicks(); render();
setTimeout(()=>map.invalidateSize(),300);

/* ---------- 天气模块 ---------- */
const WEATHER=DATA.weather;
const wCities={}; WEATHER.cities.forEach(c=>wCities[c.code]=c);
const wTrips={}; WEATHER.trips.forEach(t=>wTrips[t.code]=t);
document.getElementById('wgDry').textContent=WEATHER.gradeCounts.dry||0;
document.getElementById('wgMild').textContent=WEATHER.gradeCounts.mild||0;
document.getElementById('wgWet').textContent=WEATHER.gradeCounts.wet||0;
document.getElementById('wgHeavy').textContent=WEATHER.gradeCounts.heavy||0;

const wmap=L.map('wmap',{zoomControl:true,worldCopyJump:true,minZoom:1}).setView([22,110],3);
L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  {subdomains:['1','2','3','4'],maxZoom:16,attribution:'&copy; 高德地图'}).addTo(wmap);
L.circleMarker([DATA.origin.lat,DATA.origin.lng],{radius:7,color:'#fff',weight:2,fillColor:'#2563d9',fillOpacity:1}).addTo(wmap).bindTooltip('广州 CAN · 出发地',{permanent:false});
const wLayer=L.layerGroup().addTo(wmap);
const wMarkers={};
function wRadius(t){ return 6 + Math.min(11, t.summary.dryDays*1.7); }
function renderWMap(){
  wLayer.clearLayers();
  WEATHER.trips.forEach(t=>{
    const g=W[t.grade];
    const m=L.circleMarker([t.lat,t.lng],{radius:wRadius(t),color:'#fff',weight:1.5,fillColor:g.color,fillOpacity:.85,className:'mk'}).addTo(wLayer);
    m.bindTooltip('<b>'+t.city+'</b> · '+g.label+'<br><span style="color:#666">出行 '+t.dep.slice(5)+'~'+t.ret.slice(5)+' · 晴日 '+t.summary.dryDays+'/'+t.summary.days+' · 降雨概率均 '+t.summary.avgPop+'%</span>',{direction:'top',offset:[0,-4]});
    m.on('click',()=>wSelect(t.code,true));
    wMarkers[t.code]=m;
  });
}
function wIcon(code){ if(code<=3)return'☀️'; if(code<=48)return'⛅'; return'🌧️'; }
function wRowHTML(t){
  const g=W[t.grade];
  const c=wCities[t.code];
  const fc= c&&c.daily ? c.daily.filter(d=>d.date>=t.dep&&d.date<=t.ret).map(d=>{
    const heavy=d.prcp>=25, wet=d.prcp>=1;
    const col= heavy?'#fdecee':(wet?'#eaf0fd':'#e7f6ee');
    return '<div class="wfcday" style="background:'+col+'"><div class="d">'+d.date.slice(5)+'</div><div class="r">'+wIcon(d.code)+'</div><div class="t">'+Math.round(d.tmax)+'°</div><div class="p">💧'+d.pop+'%</div></div>';
  }).join('') : '';
  return '<div class="wrow" data-code="'+t.code+'">'+
    '<div class="wr-top"><div class="wr-city">'+t.city+'<span class="code">'+t.code+'</span></div>'+
      '<span class="wr-g" style="background:'+g.color+'">'+g.label+'</span></div>'+
    '<div class="wr-sub"><span>出行 <b>'+t.dep.slice(5)+'~'+t.ret.slice(5)+'</b> · '+t.summary.days+'天</span>'+
      '<span>晴日 <b>'+t.summary.dryDays+'/'+t.summary.days+'</b></span>'+
      '<span>降雨概率均 <b>'+t.summary.avgPop+'%</b></span>'+
      '<span>高温 <b>'+t.summary.tmax+'°</b></span>'+
      (t.tier?('<span class="badge '+(t.tier==='A'?'r':'')+'">机票 '+t.tier+' 档 ¥'+t.minPrice+'</span>'):'')+'</div>'+
    '<div class="wfc">'+fc+'</div></div>';
}
function renderWList(){
  let h='';
  wOrder.forEach(g=>{
    const ts=WEATHER.trips.filter(t=>t.grade===g); if(!ts.length) return;
    h+='<div class="wgroup-hd"><span class="dot" style="background:'+W[g].color+'"></span>'+W[g].label+'（'+ts.length+'）— '+W[g].desc+'</div>';
    ts.sort((a,b)=> b.summary.dryDays-a.summary.dryDays || a.summary.avgPop-b.summary.avgPop);
    h+=ts.map(wRowHTML).join('');
  });
  document.getElementById('wlist').innerHTML=h;
  document.querySelectorAll('.wrow').forEach(el=>{
    el.onclick=()=>{ const c=el.dataset.code; el.classList.toggle('open'); wSelect(c,false); };
  });
}
function wSelect(code,fromMap,quiet){
  const t=wTrips[code]; if(!t) return;
  document.querySelectorAll('.wrow').forEach(el=>el.classList.toggle('sel',el.dataset.code===code));
  document.getElementById('wcnt').textContent='当前：'+t.city+'（'+t.code+'） · '+W[t.grade].label+' · 出行 '+t.dep.slice(5)+'~'+t.ret.slice(5);
  if(fromMap){ const el=document.querySelector('.wrow[data-code="'+code+'"]'); if(el){el.classList.add('open');el.scrollIntoView({behavior:'smooth',block:'center'});} }
  else if(!quiet){ if(wMarkers[code]) wMarkers[code].openTooltip(); }
  wmap.flyTo([t.lat,t.lng], wmap.getZoom()<4?4:wmap.getZoom(), {duration:.7});
}
function renderWSrc(){
  const s=WEATHER.sources||[];
  document.getElementById('wsrc').innerHTML='<b>📚 数据来源与引用链接</b>'+
    s.map(x=>'<a href="'+x.url+'" target="_blank" rel="noopener">'+x.name+' <span class="wtag">'+x.url.replace('https://','').replace('http://','')+'</span></a><div class="sdesc">'+x.desc+'</div>').join('')+
    '<div class="sdesc" style="margin-top:6px">预测方法：7/31 起约 16 天为 Open-Meteo 逐日数值预报（ICON/GFS/ECMWF 集成）；8/16 之后按近 5 年同期 ERA5 再分析气候常态推算，仅供参考，出行前请复核官方预警。</div>';
}
renderWMap(); renderWList(); renderWSrc();
setTimeout(()=>wmap.invalidateSize(),300);
</script>
</body>
</html>`;

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('生成 index.html (' + Math.round(html.length / 1024) + ' KB)');

// 控制台摘要，供推送
const out = [];
for (const t of ['A', 'B']) {
  const p = P[t]; if (!p) continue;
  out.push('### ' + (t === 'A' ? 'A 档 · 往返 < ¥1000' : 'B 档 · 往返 ¥1000~2000'));
  for (const [k, label] of [['cheapest', '最便宜'], ['discount', '折扣最大'], ['most', '航次最多']]) {
    const r = p[k]; const o = r.options[0];
    out.push('- ' + label + '：' + r.city + '(' + r.code + ') ¥' + r.minPrice +
      ' | ' + o.depDate + ' 去 / ' + o.retDate + ' 回（' +
      Math.round((Date.parse(o.retDate + 'T00:00:00Z') - Date.parse(o.depDate + 'T00:00:00Z')) / 86400000) + ' 天）| ' +
      o.out.flights.map(f => f.no).join('+') + ' ' + o.airlineNames.join('/') +
      (o.direct ? ' 直飞' : ' 含中转') +
      ' | 低于中位价 ' + r.discountPct + '% | 航次 ' + r.optionCount + ' / 日期组合 ' + r.datePairsInBudget);
  }
}
// 天气摘要
out.push('');
out.push('### ☁️ 天气 · 出行窗口内降雨分级（7/31–8/31 全程预测）');
const gc = weatherPayload.gradeCounts;
out.push('- 🟢 干爽少雨 ' + (gc.dry || 0) + ' 个 · 🔵 偶有阵雨 ' + (gc.mild || 0) + ' 个 · 🟡 多雨 ' + (gc.wet || 0) + ' 个 · 🔴 强降雨频繁 ' + (gc.heavy || 0) + ' 个');
const best = wraw.trips.filter(t => t.grade === 'dry' || t.grade === 'mild').sort((a, b) => b.summary.dryDays - a.summary.dryDays || a.summary.avgPop - b.summary.avgPop);
out.push('- 出行窗口内最干爽（优先推荐）：' + best.slice(0, 8).map(t => t.city + '(' + t.code + ') 晴' + t.summary.dryDays + '/' + t.summary.days + '·降雨概率' + t.summary.avgPop + '%').join('、'));
out.push('- 注：7–8 月为季风雨季，无目的地全程无雨；🟢 为晴日最多、无强降雨之最优选择。');
console.log(out.join('\n'));
fs.writeFileSync(path.join(ROOT, 'data', 'summary.txt'), out.join('\n'));
