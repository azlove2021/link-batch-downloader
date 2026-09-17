#!/usr/bin/env node
/* ============================================================================
 * 批量重命名 · 纯函数单元测试
 *
 * 覆盖日期识别、格式化、模板套用。这些逻辑最容易被边界情况搞错
 * （比如把 12 位纯数字里的后 8 位当成日期），所以值得逐个用例盯住。
 *
 * 运行： npm test（会连同一致性校验一起跑）
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

/* 让浏览器风格的 IIFE 能在 Node 里加载 */
global.window = global;
require(path.join(__dirname, '..', 'js', 'rename-core.js'));
const RC = global.TB.renameCore;

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
}

function ymd(found) {
  return found ? [found.y, found.m, found.d] : null;
}

/* ---------------------------------------------------------------- 日期识别 */
const CASES = [
  // [文件名, 期望日期, 说明]
  ['IMG_20240103_001.jpg', [2024, 1, 3], '8 位紧凑写法（扫描件最常见）'],
  ['20240103.pdf', [2024, 1, 3], '纯 8 位文件名'],
  ['报销单2024-01-03.pdf', [2024, 1, 3], '短横线'],
  ['发票_2024_01_03_扫描.pdf', [2024, 1, 3], '下划线'],
  ['scan.2024.1.3.jpg', [2024, 1, 3], '点分隔 + 不补零'],
  ['2024年1月3日 会议纪要.docx', [2024, 1, 3], '中文写法'],
  ['2024年12月31日.pdf', [2024, 12, 31], '中文写法补零'],
  ['微信图片_20241231235959.jpg', [2024, 12, 31], '长数字串里提取（后面还有时间）'],
  ['a20240103b.txt', [2024, 1, 3], '两侧是普通字符'],
  ['合同 2024-13-01.pdf', null, '月份 13 非法 → 不认'],
  ['合同 2024-02-30.pdf', null, '2月30日不存在 → 不认'],
  ['IMG_00012345.jpg', null, '数字不是合法日期 → 不认'],
  ['没有日期的文件.pdf', null, '没有日期 → 返回 null'],
  ['1234567890.pdf', null, '10 位数字不应误判'],
  ['20240103', [2024, 1, 3], '纯数字文件名（无扩展名）'],
  ['19800102.pdf', null, '1980 年超出合理范围 → 不认'],
];

for (const [name, want, label] of CASES) {
  const got = ymd(RC.extractDate(name));
  eq(got, want, `识别「${name}」应为 ${JSON.stringify(want)}（${label}）`);
}

/* ------------------------------------------------- 剩余名称要收拾干净 */
const REST = [
  ['IMG_20240103_001.jpg', 'IMG_001', '去掉日期后不留双下划线'],
  ['20240103_报销单.pdf', '报销单', '去掉开头日期与其后的分隔符'],
  ['报销单_20240103.pdf', '报销单', '去掉结尾日期与前面的分隔符'],
  ['2024-01-03 会议纪要.docx', '会议纪要', '去掉空格分隔'],
];
for (const [name, want, label] of REST) {
  const f = RC.extractDate(name);
  eq(f ? f.rest : null, want, `「${name}」剩余部分应为「${want}」（${label}）`);
}

/* ------------------------------------------------------------ 日期格式化 */
eq(RC.formatDate({ y: 2024, m: 1, d: 3 }, '-'), '2024-01-03', '短横线格式补零');
eq(RC.formatDate({ y: 2024, m: 12, d: 31 }, '_'), '2024_12_31', '下划线格式');
eq(RC.formatDate({ y: 2024, m: 1, d: 3 }, '.'), '2024.01.03', '点格式');
eq(RC.formatDate({ y: 2024, m: 1, d: 3 }, 'cn'), '2024年01月03日', '中文格式');
eq(RC.formatDate({ y: 2024, m: 1, d: 3 }, 'compact'), '20240103', '紧凑格式');

/* -------------------------------------------------------------- 模板套用 */
eq(RC.applyTemplate('{date}_{name}', '2024-01-03', '报销单', 'x'), '2024-01-03_报销单',
   '默认模板 {date}_{name}');
eq(RC.applyTemplate('{name}_{date}', '2024-01-03', '报销单', 'x'), '报销单_2024-01-03',
   '日期放后面');
eq(RC.applyTemplate('{date}', '2024-01-03', '报销单', 'x'), '2024-01-03',
   '只用日期');
eq(RC.applyTemplate('{date}_{name}', '2024-01-03', '', 'IMG_001'), '2024-01-03_IMG_001',
   '剩余名称为空时回退到原名');

/* ------------------------------------------------------------ 非法字符清理 */
eq(RC.sanitize('a/b:c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i', 'Windows 非法字符替换为下划线');
eq(RC.sanitize('  两 边 空 格  '), '两 边 空 格', '首尾空格去掉');

/* -------------------------------------------------------------------- 输出 */
console.log('');
console.log(`重命名核心测试：${pass + failures.length} 项，通过 ${pass} 项`);
console.log('');
if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}
console.log('✓ 全部通过：日期识别 / 格式化 / 模板 / 非法字符清理');

