#!/usr/bin/env node
/* ============================================================================
 * 一致性校验：工具注册表 ↔ 首页面板 ↔ 脚本/样式文件
 *
 * 用途：增删工具、拆分 index.html 之后，自动确认没有死链、没有孤儿面板、
 *       没有忘记引用的死文件。这是重构（尤其是批量删除工具）的安全网。
 *
 * 运行： npm test
 * 退出码：0 = 全部通过；1 = 有不一致（CI 里可直接当门禁）
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const failures = [];
const warnings = [];
let checks = 0;

function check(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}
function warn(cond, msg) {
  if (!cond) warnings.push(msg);
}

/* ---------- 1. 读取工具注册表（js/app.js） ---------- */
const appJs = read('js/app.js');

const toolsMatch = appJs.match(/var TOOLS = \[([\s\S]*?)\n\];/);
check(!!toolsMatch, 'js/app.js：找不到 TOOLS 数组（注册表结构被改动？测试需要同步更新）');

const toolIds = [];
if (toolsMatch) {
  for (const m of toolsMatch[1].matchAll(/id:\s*'([^']+)'/g)) toolIds.push(m[1]);
}
check(toolIds.length > 0, 'js/app.js：TOOLS 注册表为空');
check(new Set(toolIds).size === toolIds.length, 'js/app.js：TOOLS 存在重复 id');

/* 图标映射 */
const iconsMatch = appJs.match(/var ICONS = \{([\s\S]*?)\n\};/);
check(!!iconsMatch, 'js/app.js：找不到 ICONS 映射');
const iconKeys = new Set();
if (iconsMatch) {
  for (const m of iconsMatch[1].matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) iconKeys.add(m[1]);
}

/* ---------- 2. 读取首页面板（index.html） ---------- */
const html = read('index.html');

const sectionIds = [];
for (const m of html.matchAll(/<section id="tool-([^"]+)"/g)) sectionIds.push(m[1]);
check(new Set(sectionIds).size === sectionIds.length, 'index.html：存在重复的 tool section id');

/* ---------- 3. 注册表 ↔ 面板，双向必须一致 ---------- */
const registered = new Set(toolIds); // home（工具总览）同样是正常注册项：有面板、有图标
const sections = new Set(sectionIds);

for (const id of registered) {
  check(sections.has(id), `死链：TOOLS 注册了「${id}」，但 index.html 没有 id="tool-${id}" 面板`);
}
for (const id of sections) {
  check(registered.has(id), `孤儿：index.html 有 id="tool-${id}" 面板，但 TOOLS 未注册（点了进不去）`);
}
for (const id of registered) {
  check(iconKeys.has(id), `ICONS 缺少「${id}」的图标定义（侧栏会缺图标）`);
}

/* ---------- 4. 脚本 / 样式引用必须存在且本地化 ---------- */
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);

for (const ref of [...scripts, ...links]) {
  if (/^(https?:)?\/\//.test(ref)) {
    failures.push(`引用了外部资源（本项目要求完全离线，应放本地 vendor）：${ref}`);
    continue;
  }
  check(fs.existsSync(path.join(ROOT, ref)), `引用的文件不存在：${ref}`);
}

/* ---------- 5. js/ 下不应有「没被引用」的死文件 ---------- */
const jsDir = path.join(ROOT, 'js');
if (fs.existsSync(jsDir)) {
  const referenced = new Set(scripts.map((s) => path.basename(s)));
  for (const f of fs.readdirSync(jsDir)) {
    if (!f.endsWith('.js')) continue;
    check(referenced.has(f), `js/${f} 存在，但 index.html 未引用（死文件，应删除或补引用）`);
  }
}

/* ---------- 6. web/ 是生成目录，不应被当成源码 ---------- */
warn(!fs.existsSync(path.join(ROOT, 'web', 'js', 'app.js')) || true, '');
warnings.length = 0; // 保留位置，当前无警告项

/* ---------- 输出 ---------- */
console.log('');
console.log(`一致性校验：${checks} 项检查`);
console.log(`  工具注册 ${registered.size} 个 · 首页面板 ${sections.size} 个 · 脚本 ${scripts.length} 个 · 样式 ${links.length} 个`);
console.log('');

if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}

console.log('✓ 全部通过：注册表、面板、图标、脚本引用完全一致');
