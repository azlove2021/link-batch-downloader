#!/usr/bin/env node
/* ============================================================================
 * 重复文件查找 · 纯函数单元测试（大小分组 / 保留选择 / 相似名配对）
 * 运行： npm test
 * ==========================================================================*/
'use strict';

const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'data-core.js'));   /* similarNamePairs 依赖其 similarity */
require(path.join(__dirname, '..', 'js', 'dup-core.js'));
const DPC = global.TB.dupCore;

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
}

/* ---------------------------------------------------------------- 大小分组 */
eq(DPC.groupBySize([{ size: 10 }, { size: 20 }, { size: 10 }, { size: 10 }]),
   [[0, 2, 3]], '同大小归一组，独苗不进组');
eq(DPC.groupBySize([{ size: 1 }, { size: 2 }]), [], '没有同大小 → 空');
eq(DPC.groupBySize([]), [], '空输入');
eq(DPC.groupBySize(null), [], 'null 安全');
eq(DPC.groupBySize([{ size: 0 }, { size: 0 }]).length, 1, '0 字节文件也能分组');

/* ---------------------------------------------------------------- 保留选择 */
eq(DPC.pickKeeper([{ path: 'a/b/deep.txt' }, { path: 'top.txt' }, { path: 'a/x.txt' }]),
   1, '层级最浅的保留');
eq(DPC.pickKeeper([{ path: 'a/longer-name.txt' }, { path: 'a/short.txt' }]),
   1, '同深度取路径短的');
eq(DPC.pickKeeper([{ path: 'a/b.txt' }, { path: 'a/a.txt' }]),
   1, '同长度取字典序小的（结果稳定）');
eq(DPC.pickKeeper([{ path: 'only.txt' }]), 0, '单元素');

/* ---------------------------------------------------------------- 相似名配对 */
const files = [
  { name: '报告 2024.docx' },      /* 0 */
  { name: '报告2024.docx' },       /* 1 —— 与 0 相似 */
  { name: '完全无关的文件.txt' },  /* 2 */
  { name: 'invoice-001.pdf' },     /* 3 */
  { name: 'invoice-002.pdf' },     /* 4 —— 与 3 相似 */
];
const pairs = DPC.similarNamePairs(files, { threshold: 0.8 });
const has = (a, b) => pairs.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
eq(has(0, 1), true, '空格差异 → 判相似');
eq(has(3, 4), true, '序号差异 → 判相似');
eq(has(0, 2), false, '无关文件不配对');
eq(pairs.every((p) => p.a < p.b), true, '返回原始下标且 a<b');
eq(pairs.every((p) => p.score >= 0.8), true, 'score 不低于阈值');
const strict = DPC.similarNamePairs(files, { threshold: 0.999 });
eq(strict.length, 1, '阈值 0.999：只剩「归一化后完全相同」的一对（空格差异 score=1）');
eq(strict[0].a === 0 && strict[0].b === 1, true, '剩下的正是 报告 2024 / 报告2024');
eq(DPC.similarNamePairs(files, { threshold: 1.01 }).length, 0, '阈值 >1 → 无配对');
eq(DPC.similarNamePairs([], {}), [], '空输入');

/* ---------------------------------------------------------------- 输出 */
console.log('');
console.log(`dup-core 单元测试：${pass + failures.length} 项，通过 ${pass} 项`);
if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('✓ 全部通过：大小分组 / 保留选择 / 相似名配对');
