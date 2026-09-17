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
const vm = require('vm');

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

/** 返回所有 <section id="tool-X"> 的 {id, start, innerStart, end}（按文档顺序） */
function findSections(html) {
  const re = /<section\b[^>]*>|<\/section>/g;
  const stack = [];
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) {
      const s = stack.pop();
      if (s) out.push({ id: s.id, start: s.start, innerStart: s.innerStart, end: re.lastIndex });
    } else {
      const idm = m[0].match(/id="tool-([^"]+)"/);
      stack.push({ id: idm ? idm[1] : null, start: m.index, innerStart: re.lastIndex });
    }
  }
  return out;
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

/* ---------- 6. JS 里引用的元素 id 必须真实存在 ----------
 * 这是删减面板之后最容易踩的坑：面板删了、JS 没删，打开页面就在控制台报错，
 * 而且往往会让整个功能静默失效。 */
const htmlIds = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) htmlIds.add(m[1]);

const runtimeJs = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));

/* JS 自己动态创建的元素 id：写得再安全（if(el) 判断）也经不起面板被删，
 * 这里把它们收集起来，避免误报。 */
const createdIds = new Set(['dashMoreBtn']);
for (const f of runtimeJs) {
  const src = read(path.join('js', f));
  for (const m of src.matchAll(/\.id\s*=\s*'([A-Za-z][\w-]*)'/g)) createdIds.add(m[1]);
  for (const m of src.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) createdIds.add(m[1]); // innerHTML 里拼出来的
}

let idRefs = 0;
let dynamicRefs = 0;
for (const f of runtimeJs) {
  const src = read(path.join('js', f));
  const refs = new Set();
  for (const m of src.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) refs.add(m[1]);
  for (const m of src.matchAll(/getElementById\('([A-Za-z][\w-]*)'\)/g)) refs.add(m[1]);
  for (const id of refs) {
    idRefs++;
    if (createdIds.has(id)) { dynamicRefs++; continue; }
    check(htmlIds.has(id),
      `js/${f} 引用了不存在的元素 #${id}（面板已删但代码还在 → 打开页面会报错）`);
  }
}

/* ---------- 7. HTML 结构完整性 ----------
 * 批量删减/搬移面板之后最容易出的问题：标签不配对、id 重复。 */
const divOpen = (html.match(/<div\b/g) || []).length;
const divClose = (html.match(/<\/div>/g) || []).length;
check(divOpen === divClose, `<div> 标签不配对：开 ${divOpen} / 闭 ${divClose}`);

const secOpen = (html.match(/<section\b/g) || []).length;
const secClose = (html.match(/<\/section>/g) || []).length;
check(secOpen === secClose, `<section> 标签不配对：开 ${secOpen} / 闭 ${secClose}`);

const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const dupIds = allIds.filter((id, i) => allIds.indexOf(id) !== i);
check(dupIds.length === 0, `index.html 存在重复 id：${[...new Set(dupIds)].join(', ') || '无'}`);

/* ---------- 8. 合并进大工具的面板确实落在了父面板内部 ---------- */
const MERGED = [
  ['哈希对比', 'hash'],
  ['图片裁剪', 'image'],
  ['长图拼接', 'image'],
  ['PDF 加密', 'pdf'],
  ['统一输出目录', 'desk'],
];
const sectionsNow = findSections(html);
for (const [title, parent] of MERGED) {
  const marker = `由独立工具合并而来：${title}`;
  const idx = html.indexOf(marker);
  check(idx >= 0, `合并标记缺失：「${title}」应并入 ${parent} 面板`);
  if (idx < 0) continue;
  const s = sectionsNow.find((x) => x.id === parent);
  check(!!s && idx > s.start && idx < s.end,
    `「${title}」没有落在 ${parent} 面板内部（合并位置不对）`);
}

/* ---------- 9. 脚本加载顺序 ----------
 * 顺序错了不会报错，只会「功能静默失效」，比崩溃更难发现。
 * 例：rename-core.js 若排在 rename.js 之后，日期重命名会拿到空的 RC，
 *     界面照常显示、点了没反应。 */
const ordered = scripts.map((s) => s.replace(/\\/g, '/'));
const idxOf = (f) => ordered.indexOf(f);

check(idxOf('js/core.js') >= 0, 'index.html 未引用 js/core.js');
const coreIdx = idxOf('js/core.js');
for (let i = 0; i < ordered.length; i++) {
  const s = ordered[i];
  if (s === 'js/core.js' || !s.startsWith('js/') || s.includes('vendor/')) continue;
  check(i > coreIdx, `${s} 必须在 js/core.js 之后加载（TB 工具库在那里定义）`);
}

/* 明确的依赖关系 */
const ORDER_PAIRS = [
  ['js/rename-core.js', 'js/rename.js'],
  ['js/text-core.js', 'js/text.js'],
  ['js/invoice-core.js', 'js/invoice.js'],
  ['js/download-core.js', 'js/download.js'],
  ['js/folder-core.js', 'js/folderorg.js'],
  /* 数据工作台：纯函数核心要先于使用它的两个文件加载（顺序错了功能会静默失效） */
  ['js/data-core.js', 'js/datawork.js'],
  ['js/data-core.js', 'js/data-batch.js'],
  ['js/datawork.js', 'js/data-batch.js'],
];
for (const [before, after] of ORDER_PAIRS) {
  if (idxOf(before) < 0 || idxOf(after) < 0) continue;
  check(idxOf(before) < idxOf(after),
    `${before} 必须在 ${after} 之前加载（否则相关功能会静默失效）`);
}

/* ---------- 10. 业务脚本语法可解析 ----------
 * 比等到浏览器里报错要早一步；改错括号、漏引号在这里就会拦住。 */
for (const f of runtimeJs) {
  checks++;
  const src = read(path.join('js', f));
  try {
    new vm.Script(src, { filename: f });
  } catch (e) {
    failures.push(`js/${f} 语法错误：${e.message}`);
  }
}


/* ---------- 11. 侧栏菜单必须由注册表生成 ----------
 * 侧栏以前是手写 HTML：删掉工具后菜单里还留着「点进去一片空白」的老入口。
 * 现在由 app.js 的 buildSide() 依据 TOOLS 生成，这里守住三件事：
 *   ① 每个工具都归了组；② 组名都在 GRP_ORDER 里；③ 每个组下面至少有工具。 */
const grpMatch = appJs.match(/var GRP_ORDER = \[([^\]]*)\]/);
check(!!grpMatch, 'js/app.js：找不到 GRP_ORDER（侧栏分组定义被删了？）');
const grpOrder = grpMatch ? [...grpMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
check(grpOrder.length >= 3, `侧栏分组只剩 ${grpOrder.length} 个，看起来少了`);

const toolEntries = [];
if (toolsMatch) {
  for (const m of toolsMatch[1].matchAll(/\{([^{}]*?id:\s*'[^']+'[^{}]*?)\}/g)) {
    const id = (m[1].match(/id:\s*'([^']+)'/) || [])[1];
    const grp = (m[1].match(/grp:\s*'([^']*)'/) || [])[1];
    if (id) toolEntries.push({ id, grp: grp === undefined ? null : grp });
  }
}
check(toolEntries.length === toolIds.length, 'js/app.js：TOOLS 条目解析不全（对象写法变了？测试需同步）');

for (const t of toolEntries) {
  if (t.id === 'home') continue;   // 首页链接由 buildSide 单独生成
  check(t.grp !== null && t.grp !== '', `工具「${t.id}」没写 grp，侧栏里会看不到它`);
  check(grpOrder.includes(t.grp), `工具「${t.id}」的 grp「${t.grp}」不在 GRP_ORDER 里`);
}
for (const g of grpOrder) {
  check(toolEntries.some((t) => t.grp === g), `侧栏分组「${g}」下面一个工具都没有（空组）`);
}
check(/function buildSide\(\)/.test(appJs), 'js/app.js：找不到 buildSide()（侧栏生成器被删了？）');

/* ---------- 12. index.html 不允许再写死侧栏链接 ---------- */
const navBlock = html.match(/<nav class="side"[\s\S]*?<\/nav>/);
check(!!navBlock, 'index.html：找不到侧栏 <nav class="side">');
if (navBlock) {
  const hardcoded = [...navBlock[0].matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]);
  check(hardcoded.length === 0,
    `index.html 侧栏里还写死了 ${hardcoded.length} 个菜单项（应交给 app.js 生成）：${hardcoded.slice(0, 6).join('、')}`);
  check(/class="foot"/.test(navBlock[0]), 'index.html：侧栏底部的说明文字（.foot）不见了');
}


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
