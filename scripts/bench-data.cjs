#!/usr/bin/env node
/* ============================================================================
 * 性能基准 · 10 万行数据链路实测（npm run bench）
 *
 * 背景：README 宣称「10 万行不卡」，改进建议.md 工程改造 #8 指出没有
 * benchmark。本脚本补上可复现测量：固定种子生成数据（每次运行的输入
 * 完全一致），每项跑 3 轮取中位数，并给出宽松的「数量级防回归」守卫。
 *
 * 测的是纯函数链路（Node 直接跑，无需浏览器/构建）：
 *   1. core.js      parseCsv      —— 10 万行 × 8 列 CSV（含引号/中文/混合日期）
 *   2. data-core.js applyPipeline —— 4 步清洗（trim → 规范日期 → 金额 → 整行去重）
 *   3. core.js      toCsv         —— 10 万行序列化回 CSV
 *   4. data-core.js mergeTables   —— 10 万行 + 5 万行按列名合并（乱序列 + 新增列）
 *   5. data-core.js groupRowsBy   —— 按列拆表分组（约 3000 组）
 *   6. data-core.js similarity    —— 模糊匹配 1000×200 对比
 *
 * 「滚动帧率」属于浏览器渲染指标，Node 测不了：验证方式为手工——
 * 载入 10 万行后滚动工作台表格，肉眼应无长卡顿（虚拟滚动已按窗口渲染）。
 * ==========================================================================*/
'use strict';

const path = require('path');
const os = require('os');

/* core.js / data-core.js 是浏览器 IIFE，给最小的 window/document 桩即可在 Node 加载 */
global.window = global;
global.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } };
require(path.join(__dirname, '..', 'js', 'core.js'));
require(path.join(__dirname, '..', 'js', 'data-core.js'));
const U = global.TB.util;
const DC = global.TB.dataCore;

/* ---------- 确定性数据生成（固定种子 LCG，跨运行数据完全一致）
 * 乘法必须走 Math.imul：普通 * 在 seed×1103515245 > 2^53 时丢精度，
 * 低位全变 0，随机质量塌掉（实测分组数 3000 塌到 756）。 ---------- */
let seed = 20260917;
function rnd() { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function ri(n) { return Math.floor(rnd() * n); }
function pad(n) { return String(n).padStart(2, '0'); }
function q(s) { return /[",\n\r]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s; }

const HEADERS = ['订单号', '日期', '金额', '品名', '备注', '分组', '手机号', '邮箱'];
const N_ROWS = 100000;

function makeRow(i) {
  const d = 1 + ri(28), m = 1 + ri(12), y = 2022 + ri(4);
  const style = ri(3);
  const date = style === 0 ? `${y}-${pad(m)}-${pad(d)}`
             : style === 1 ? `${y}/${m}/${d}`
             : `${y}${pad(m)}${pad(d)}`;
  const amt = (rnd() * 100000).toFixed(2);
  const money = ri(2) ? '¥' + Number(amt).toLocaleString('en-US') : amt;
  const name = ri(10) < 2 ? `特殊 品名,含逗号"${i}"` : `品名-${i}-${ri(500)}`;
  const memo = ri(4) === 0 ? '含"引号"与,逗号' : `备注${ri(1000)}`;
  const phone = `1${3 + ri(6)}${String(ri(1000000000)).padStart(9, '0')}`;
  return [`SO${y}${pad(m)}${pad(d)}${String(i).padStart(6, '0')}`, date, money,
          name, memo, `组${ri(3000)}`, phone, `user${ri(50000)}@example.com`];
}

/* dupEvery=20 → 每 20 行复制一行，约 5% 重复（给去重步骤用） */
function makeRows(n, dupEvery) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = makeRow(i);
    rows.push(r);
    if (dupEvery && i % dupEvery === 0) rows.push(r.slice());
  }
  return rows;
}
function toCsvText(headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(r.map(q).join(','));
  return lines.join('\r\n');
}

/* ---------- 计时：3 轮取中位数 ---------- */
let guardFails = 0;
function bench(label, fn, guardMs) {
  const times = [];
  let out;
  for (let k = 0; k < 3; k++) {
    const t0 = process.hrtime.bigint();
    out = fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const med = times[1];
  const bad = guardMs && med > guardMs;
  if (bad) guardFails++;
  console.log(`  ${label}：中位 ${med.toFixed(0)} ms（3 轮 ${times.map((t) => t.toFixed(0)).join(' / ')} ms）` +
              (bad ? `  ✗ 超过守卫 ${guardMs} ms` : ''));
  return out;
}

/* ---------- 主流程 ---------- */
console.log('');
console.log('性能基准 · 10 万行数据链路');
console.log(`环境：Node ${process.version} · ${process.platform}/${process.arch} · ${(os.cpus()[0] || {}).model || '未知 CPU'} · 内存 ${Math.round(os.totalmem() / 1073741824)}GB`);
console.log('');

const g0 = process.hrtime.bigint();
const body = makeRows(N_ROWS, 20);            /* 105,000 行（含 5% 重复） */
const csvText = toCsvText(HEADERS, body);
console.log(`数据生成：${body.length.toLocaleString('zh-CN')} 行 × 8 列，CSV ${(csvText.length / 1048576).toFixed(1)} MB，耗时 ${(Number(process.hrtime.bigint() - g0) / 1e6).toFixed(0)} ms（不计入下列成绩）`);
console.log('');

/* 1. 解析 */
const parsed = bench(`parseCsv 解析 ${body.length.toLocaleString('zh-CN')} 行`, () => U.parseCsv(csvText), 5000);
if (parsed.length !== body.length + 1) {
  console.error(`✗ 解析行数不符：期望 ${body.length + 1}，实际 ${parsed.length}`);
  guardFails++;
}
const headers = parsed[0];
const rows = parsed.slice(1);

/* 2. 清洗流水线（与工作台「步骤模式」同一入口） */
const steps = [
  { op: 'trim' },
  { op: 'date', col: 1, colName: '日期' },
  { op: 'number', col: 2, colName: '金额' },
  { op: 'dedupe' },
];
const cleaned = bench('applyPipeline 4 步清洗（trim/日期/金额/去重）', () => DC.applyPipeline(headers, rows, steps), 15000);
console.log(`    → 清洗后 ${cleaned.rows.length.toLocaleString('zh-CN')} 行（去掉重复 ${rows.length - cleaned.rows.length} 行）`);

/* 3. 序列化 */
bench(`toCsv 序列化 ${rows.length.toLocaleString('zh-CN')} 行`, () => U.toCsv([headers].concat(rows)), 5000);

/* 4. 多表合并：B 表 5 万行、列序打乱、含新增列（按列名对齐） */
const bRows = [];
for (let i = 0; i < 50000; i++) {
  const src = rows[i * 2];
  if (!src) break;
  bRows.push([src[2], src[0], `INV${String(i).padStart(8, '0')}`, src[1]]);
}
const B = { name: 'B表', headers: ['金额', '订单号', '发票号', '日期'], rows: bRows };
const merged = bench(`mergeTables ${rows.length.toLocaleString('zh-CN')}+${bRows.length.toLocaleString('zh-CN')} 行按列名合并`,
  () => DC.mergeTables([{ name: 'A表', headers, rows }, B], { addSource: true }), 20000);
console.log(`    → 合并后 ${merged.rows.length.toLocaleString('zh-CN')} 行 × ${merged.headers.length} 列（含来源列）`);

/* 5. 按列拆表分组 */
const groups = bench(`groupRowsBy 按「分组」列拆 ${rows.length.toLocaleString('zh-CN')} 行`, () => DC.groupRowsBy(rows, 5), 5000);
console.log(`    → ${groups.length.toLocaleString('zh-CN')} 组`);

/* 6. 模糊匹配（对账用）：1000 × 200 = 20 万次相似度对比 */
const names = rows.slice(0, 1000).map((r) => r[3]);
const cands = rows.slice(5000, 5200).map((r) => r[3]);
const hits = bench('similarity 模糊匹配 1000×200 对', () => {
  let n = 0;
  for (const a of names) for (const b of cands) if (DC.similarity(a, b) > 0.8) n++;
  return n;
}, 10000);
console.log(`    → 命中 ${hits} 对`);

console.log('');
if (guardFails) {
  console.error(`✗ ${guardFails} 项失败（超守卫或校验不符）——性能数量级回归，请排查后再发布`);
  process.exit(1);
}
console.log('✓ 全部在下限守卫内。守卫只防数量级回归；精确对比请在同一台机器上跑 npm run bench 比中位数。');
