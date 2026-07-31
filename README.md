# 广州出发 · 机票低价 + 天气监控

一个开箱即用的小工具：定时扫描**广州（CAN）出发**到全国/全球各地的往返机票，
筛选出低价航线，生成「左侧地图 + 右侧可排序列表」的网页；并叠加每个出行目的地的
**天气预测**，用颜色标注出行窗口内是否少雨，帮你挑一个又便宜又不太淋雨的去处。

> 示例页面（本仓库作者部署的实例）：
> https://808fb04b1f3746d2af1d71b2f9258f17.gz1.agentos-app.net
>
> 源码仓库：https://github.com/a9f7/ticketmonitor （欢迎 fork / 提 PR）

---

## 功能

- **低价扫描**：覆盖约 115 条航线（国内/港澳台 + 亚洲 + 大洋洲/欧洲/美洲/非洲主要城市）。
- **价格分档**：A 档 往返 < ¥1000，B 档 ¥1000–2000。
- **航司过滤**：排除国内廉价航空（春秋 9C、九元 AQ、西部 PN、中国联合 KN、祥鹏 8L、
  瑞丽 DR、长龙 GJ、乌鲁木齐 UQ、多彩贵州 GY），保留外国低成本航司（亚航、越捷、宿务等）。
- **行程约束**：仅保留去回程 **5–9 天** 的行程。
- **三类推荐**：每档给出「最便宜 / 折扣最大 / 航次最多」三项。
- **天气模块**：7/31–8/31 全程预测；天气地图按出行窗口内降雨强度分 4 色
  （🟢干爽 / 🔵偶有阵雨 / 🟡多雨 / 🔴强降雨频繁）；可展开逐日预报；附数据引用链接。

---

## 快速开始

需要 **Node ≥ 18**（用到全局 `fetch`）。无需 `npm install`，核心脚本只用 Node 内置模块。

```bash
# 一键跑完：抓取机票 -> 抓取天气 -> 构建页面 -> 复制到 dist/
node scripts/pipeline.js
```

分步运行：

```bash
node scripts/scrape.js    # -> data/flights.json
node scripts/weather.js   # -> data/weather.json
node scripts/build.js     # -> index.html + data/summary.txt
```

运行后：

- `index.html` —— 自包含单文件页面（地图库与数据全部内联），直接用浏览器打开即可。
- `data/summary.txt` —— 纯文字版推荐结论，方便推送到聊天/邮件。
- `dist/` —— 用于部署到静态托管（见下文）。

---

## 配置（改这几个常量即可）

| 想改什么 | 文件 | 位置 |
| --- | --- | --- |
| 出发地 / 出行窗口 | `scripts/scrape.js` | `ORIGIN`、`WIN_START`、`WIN_END` |
| 行程天数 | `scripts/scrape.js` | `TRIP_MIN_DAYS` / `TRIP_MAX_DAYS` |
| 排除的廉价航司 | `scripts/scrape.js` | `EXCLUDE_CARRIERS` |
| 目的地航线表 | `scripts/destinations.js` | `module.exports` 数组（城市 / 机场代码 / 经纬度 / 时区） |
| Trip.com 接口封装 | `scripts/api.js` | `CID` / `VID` 等请求头与 POST 封装 |
| 价格分档阈值 | `scripts/scrape.js` | `TIER_A_MAX`、`TIER_B_MAX` |

天气模块的城市取自航班命中航线，无需单独维护。

---

## 部署

`index.html` 是自包含单文件，可放到任意静态托管（GitHub Pages、Netlify、CloudStudio 等）。
作者本人通过 WorkBuddy 的 CloudStudio 把 `dist/` 发布为公网站点；fork 后你可以用自己顺手的
方式部署，仓库不绑定任何特定平台。

---

## 数据来源与版权

- **机票价格**：Trip.com 公开航班查询接口（低价日历 / 航班列表）。价格为 1 名成人经济舱
  往返含税预估总价，实时波动，仅供个人参考，以最终下单页为准。
- **天气**：[Open-Meteo](https://open-meteo.com/) 逐日数值预报（ICON / GFS / ECMWF 集成）
  与历史天气 API（ERA5 再分析）。天气代码参照 WMO 标准。

请遵守各数据源的使用条款，本工具仅用于**个人出行参考**，勿用于商业爬虫或高频请求。

## 免责声明

本仓库为个人项目示例，不保证数据准确性、可用性，亦不对据此产生的任何行程/消费决策负责。
