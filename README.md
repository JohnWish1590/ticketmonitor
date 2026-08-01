# 机票锁定（FareLock）· 全国机票低价监控

一个开箱即用的机票低价监控工具：定时扫描**一个或多个出发地**（支持同一城市多机场，
如上海拆 `SHA` 虹桥与 `PVG` 浦东）到各地的往返机票，筛选出低价航线，生成
「左侧地图 + 右侧可排序列表」的网页；并叠加每个目的地的**天气预测**，用颜色标注出行窗口内是否少雨，
帮你挑一个又便宜又不太淋雨的去处。

> ⚠️ **归属说明**：本项目是在 [a9f7/ticketmonitor](https://github.com/a9f7/ticketmonitor) 的基础上学习、改写而来。
> 原始项目以「大湾区出发」为主题，本仓库将其重构为**出发地完全可自定义、面向全国**的独立版本，
> 并新增了「网页内一键设置提醒」「目的地按城市筛选」「Apple 风界面」等能力。感谢原作者的开源。

本仓库特点：

- **查询页为主，提醒内嵌其中**：地图 + 卡片 + 筛选的查询页是核心；提醒不是独立后台，而是在查询页上直接设置。
- **出发地按机场自定义**：出发地是机场级的可配置数组（如上海 `SHA` / `PVG` 分别列出），监控会逐个跑一遍，互不串味。
- **目的地按城市筛选**：查询页可按目的地城市一键过滤，不按机场分。
- **提醒只需填一次**：Server酱 SendKey 在网页上统一填写一次 + 申请链接，无需每条航线单独设。
- **Apple 风界面**：系统字体、白色卡片、细边框、克制蓝、大留白，PC 与手机均适配。

---

## 功能

- **低价扫描**：覆盖国内/港澳台 + 亚洲 + 大洋洲/欧洲/美洲/非洲主要城市（可在设置页自定义目的地）。
- **价格分档（默认）**：A 档 往返 < ¥1000，B 档 ¥1000–2000；阈值可在设置页调整。
- **航司过滤**：默认排除国内廉价航空（春秋 9C、九元 AQ、西部 PN、中国联合 KN、祥鹏 8L、瑞丽 DR、
  长龙 GJ、乌鲁木齐 UQ、多彩贵州 GY），保留外国低成本航司（亚航、越捷、宿务等）。
- **行程约束（默认）**：仅保留去回程 **5–9 天** 的行程，可在设置页调整。
- **三类推荐**：每档给出「最便宜 / 折扣最大 / 航次最多」三项。
- **天气模块**：出行窗口内全程预测；天气地图按降雨强度分 4 色
  （🟢干爽 / 🔵偶有阵雨 / 🟡多雨 / 🔴强降雨频繁）；可展开逐日预报；附数据引用链接。
- **网页内提醒设置**：查询页右上角「⚙ 提醒设置」即可配置 Server酱 与触发阈值，保存后经 GitHub API 写回仓库。

---

## 快速开始（本地）

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
- `dist/` —— 由流水线生成，用于 GitHub Pages 部署。

---

## 云端使用（GitHub Pages + 定时任务）

本仓库自带 `.github/workflows/monitor.yml`，在 GitHub Actions 上**每 2 小时**自动跑一遍
`scrape → weather → build → 实时提醒`，并把生成的 `index.html` 部署到 **GitHub Pages**；
每天北京时间 09:00 额外发一次当日汇总。

### 1. Fork 并启用

1. 点右上角 **Fork** 把本仓库复制到你的账号（默认即为**公开仓库**）。
2. 在你的仓库 **Settings → Pages**，Source 选 **GitHub Actions**（首次部署后自动生效）。
3. 在 **Actions** 标签页找到 `机票锁定 · 低价监控` 工作流，点 **Enable** 启用定时运行
   （GitHub 默认会禁用 fork 仓库的定时工作流，必须手动开一次）。

> 不想公开的，可以把仓库设为 Private；但**公开仓库才能用 GitHub Pages 免费托管**。
> 若设为私有，可用 Netlify / CloudStudio 等托管 `dist/`。

### 2. 配置出发地与目的地（数据设置页）

所有运行参数集中在仓库根目录的 **`config.json`**。仓库内附 `settings.html`，
它**直接通过 GitHub API 读写 config.json**，所以手机 / 任意电脑开浏览器就能改，改完下一轮自动生效。

打开（把 `JohnWish1590` 换成你的用户名）：

```
https://<你的用户名>.github.io/ticketmonitor/settings.html
```

首次在顶部「连接 GitHub」填 PAT 令牌（GitHub → Settings → Developer settings →
Personal access tokens → Tokens (classic) → 勾 `repo` 全选）。令牌仅存你本浏览器 localStorage，不经任何服务器。
默认仓库 `JohnWish1590` / `ticketmonitor` / `master`，改完点「保存设置」即写回 `master` 分支。

页面可配置：出发地（按机场，可多个）、出行窗口、行程天数、价格分档、排除廉价航司、监控目的地、提醒阈值等。

### 3. 设置提醒（查询页内，填一次即可）

打开已部署的查询页 `https://<你的用户名>.github.io/ticketmonitor/`，点右上角 **⚙ 提醒设置**：

- **Server酱 SendKey**：点「去申请」跳 [sct.ftqq.com](https://sct.ftqq.com/)，微信扫码关注「方糖」拿到
  SendKey（形如 `SCTxxxx`）。**网页上填一次**即可，下一轮降价自动推微信。
- **价格上限 / 折扣下限 / 冷却**：满足「往返 ≤ 价格上限 **或** 折扣 ≥ 折扣下限」即触发推送；同航线冷却期内不重复打扰。
- 点「测试推送」可先验证 Key 是否有效；点「保存设置」经 GitHub API 写回 `config.json`。

> 🔐 **公开仓库的安全提示**：本仓库为公开仓库时，`config.json`（含 SendKey）会随仓库公开可见，
> 他人可借此向你推送消息（可在 Server酱 后台随时作废重置）。若更看重私密，推荐改用
> 仓库 **Settings → Secrets and variables → Actions** 新建密钥 **`SCT_SENDKEY`**——
> 该方式优先于网页填写，且密钥不进仓库。两者留其一即可。

---

## 实时特价提醒（触发式推送 · 经 Server酱 到微信）

机票特价窗口往往只有几小时到一天，**每天推一次汇总没时效性**。所以提醒做成**触发式**：
每一轮抓取完成后，凡满足触发条件的航线会**立刻**推到你的微信。

触发条件（存于 `config.json` 的 `alerts`）：

- `maxPrice`：往返总价 ≤ 此值即触发（留空 = 不按价格触发）；
- `minDiscount`：低于窗口期内价格中位价 ≥ 此百分比即触发（留空 = 不按折扣触发）；
- 二者是「**或**」的关系——满足任意一个就推。

**去重**：已达标但近期提醒过的航线不会反复刷屏；只有出现**更低价**，或距上次提醒超过
`cooldownHours` 冷却期，才会再次推送。提醒状态存在 `data/alert-state.json`
（GitHub Actions 下用 artifact 跨次运行持久化）。

> 实时提醒内容：命中条件的「新低价 / 更低价」航线列表（城市、价格、折扣、去回日期、航司、是否直飞）。
> Server酱免费档对个人低频使用足够。

---

## 部署（GitHub Pages）

`index.html` 是自包含单文件（地图库与数据全部内联）。本仓库工作流已配置：

- `pipeline.js` 生成 `dist/index.html`；
- `monitor.yml` 用 `actions/upload-pages-artifact` + `actions/deploy-pages` 自动部署到 GitHub Pages。

你只需在仓库 **Settings → Pages** 把 Source 设为 **GitHub Actions**，之后每次定时运行都会自动更新线上页面。
（也可把 `dist/` 放到任意静态托管：Netlify、CloudStudio 等。）

---

## config.json 字段说明

| 字段 | 含义 |
| --- | --- |
| `origins` | 出发地数组，支持多个；每项 `{code,city,lat,lng,tz}`。同一城市不同机场要分别列出（如上海 `{code:'SHA',city:'上海·虹桥'}` 与 `{code:'PVG',city:'上海·浦东'}`），用机场三字码唯一标识。旧的单个 `origin` 对象仍向后兼容 |
| `window` | 出行窗口：`start` 最早出发、`end` 最晚返回（YYYY-MM-DD） |
| `tripMinDays` / `tripMaxDays` | 行程最短 / 最长天数（去→回） |
| `tierA` / `tierB` | A 档 / B 档价格上限（元，往返总价）；超过 `tierB` 不显示 |
| `excludeCarriers` | 要排除的廉价航司二字码数组 |
| `destinations` | （可选）自定义监控目的地数组，每项 `{code,city,region,lat,lng,tz,alt?}`。不写 = 用内置全量城市；写了 = 只监控列出的城市 |
| `alerts` | 实时提醒：`enabled` 开关、`maxPrice` 往返总价上限、`minDiscount` 折扣比例下限、`cooldownHours` 冷却间隔（小时）、`sendKey` Server酱 密钥（网页填写；私密优先用仓库 Secret `SCT_SENDKEY`） |

天气模块的城市取自航班命中航线，无需单独维护。

---

## 数据来源与版权

- **机票价格**：Trip.com 公开航班查询接口（低价日历 / 航班列表）。价格为 1 名成人经济舱
  往返含税预估总价，实时波动，仅供个人参考，以最终下单页为准。
- **天气**：[Open-Meteo](https://open-meteo.com/) 逐日数值预报（ICON / GFS / ECMWF 集成）
  与历史天气 API（ERA5 再分析）。天气代码参照 WMO 标准。

本项目学习自 [a9f7/ticketmonitor](https://github.com/a9f7/ticketmonitor)，遵循其开源精神，
请遵守各数据源的使用条款，本工具仅用于**个人出行参考**，勿用于商业爬虫或高频请求。

## 免责声明

本仓库为个人项目示例，不保证数据准确性、可用性，亦不对据此产生的任何行程/消费决策负责。
