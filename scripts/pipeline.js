// 机票监控统一流水线：抓取 -> 天气 -> 构建 -> 复制到 dist/
// 用于定时自动化：每轮只需运行一次本脚本，再执行 CloudStudio 重新部署即可。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 默认使用当前 node 可执行文件（自动化中以受管 node 运行即为受管版本）
const node = process.argv[2] || process.execPath;

function run(script) {
  console.log('\n=== 运行 ' + script + ' ===');
  const r = spawnSync(node, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (r.error) {
    console.error(script + ' 运行异常:', r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(script + ' 退出码非 0:', r.status);
    process.exit(r.status || 1);
  }
}

run('scrape.js');
run('weather.js');
run('build.js');

// 同步到部署目录
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(ROOT, 'dist', 'index.html'));
fs.mkdirSync(path.join(ROOT, 'dist', 'data'), { recursive: true });
for (const f of ['flights.json', 'weather.json', 'summary.txt']) {
  const src = path.join(ROOT, 'data', f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(ROOT, 'dist', 'data', f));
  }
}
console.log('\n✅ 流水线完成，dist/ 已就绪，可重新部署。');
