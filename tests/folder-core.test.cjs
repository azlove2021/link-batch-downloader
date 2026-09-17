#!/usr/bin/env node
/* ============================================================================
 * 文件夹归类 · 纯函数单元测试（规则分桶 / 计划汇总 / 归类报告）
 *
 * bucketFor 是归类的唯一判据：桶名算错 = 文件进错文件夹（虽然有撤销，
 * 但没人想撤）。reportRows 是处理报告的归类部分，状态列不许写错。
 *
 * 运行： npm test
 * ==========================================================================*/
'use strict';

const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'folder-core.js'));
const FB = global.TB.folderCore;

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
}

const T = (name, size, lm) => ({ name, size, lastModified: lm });

/* ---------------------------------------------------------------- 按扩展名 */
eq(FB.bucketFor(T('report.PDF'), 'ext'), 'pdf', 'ext：大写扩展名转小写');
eq(FB.bucketFor(T('archive.tar.gz'), 'ext'), 'gz', 'ext：多段扩展名取最后一段');
eq(FB.bucketFor(T('README'), 'ext'), '无扩展名', 'ext：无扩展名');

/* ---------------------------------------------------------------- 按日期 */
const lm = new Date(2024, 2, 15, 10, 30).getTime();   /* 2024-03-15 */
eq(FB.bucketFor(T('a.txt', 1, lm), 'yearmonth'), '2024-03', 'yearmonth：补零');
eq(FB.bucketFor(T('a.txt', 1, lm), 'year'), '2024', 'year');
eq(FB.bucketFor(T('a.txt', 1), 'yearmonth'), '未知日期', '无 lastModified → 未知日期');

/* ---------------------------------------------------------------- 按关键字 */
eq(FB.bucketFor(T('3月发票扫描.pdf'), 'keyword', ['发票', '合同']), '发票', 'keyword：命中');
eq(FB.bucketFor(T('inv-001.pdf'), 'keyword', ['INV']), 'INV', 'keyword：大小写不敏感，返回原关键字');
eq(FB.bucketFor(T('周报.docx'), 'keyword', ['发票', '合同']), '其他', 'keyword：未命中归其他');
eq(FB.bucketFor(T('xab.txt'), 'keyword', ['a', 'ab']), 'a', 'keyword：先命中先得');

/* ---------------------------------------------------------------- 前缀 / 大小 */
eq(FB.bucketFor(T('AB123.txt'), 'prefix'), 'AB', 'prefix：前 2 位');
eq(FB.bucketFor(T('A'), 'prefix'), 'A', 'prefix：不足 2 位取全部');
eq(FB.bucketFor(T('a.txt', 50 * 1024), 'size'), '<100KB', 'size：<100KB');
eq(FB.bucketFor(T('a.txt', 0.5 * 1024 * 1024), 'size'), '100KB-1MB', 'size：100KB-1MB');
eq(FB.bucketFor(T('a.txt', 200 * 1024 * 1024), 'size'), '>=100MB', 'size：>=100MB');
eq(FB.bucketFor(T('a.txt'), 'unknownMode'), '其他', '未知规则 → 其他');

/* ---------------------------------------------------------------- 汇总 */
const sum = FB.summarizePlan([
  { name: 'b.txt', to: 'pdf' }, { name: 'a.txt', to: 'jpg' },
  { name: 'c.txt', to: 'pdf' }, { name: 'd.txt', to: 'pdf' }, { name: 'e.txt', to: 'pdf' },
]);
eq(sum.length, 2, 'summarize：组数');
eq(sum.find((s) => s.key === 'pdf').sample.length, 3, 'summarize：示例最多 3 个（取大组验证截断）');
eq(sum.find((s) => s.key === 'pdf').count, 4, 'summarize：计数');
eq(sum[0].key, 'jpg', 'summarize：按 key 排序');
eq(FB.summarizePlan(null), [], 'summarize：null 安全');

/* ---------------------------------------------------------------- 报告 */
const rows = FB.reportRows([{
  ts: new Date(2026, 8, 17, 12, 0, 0).getTime(), mode: '按扩展名', root: 'Demos',
  items: [{ name: 'a.pdf', to: 'pdf', ok: true },
          { name: 'b.pdf', to: 'pdf', ok: false },
          { name: 'c.pdf', to: 'pdf', ok: true, undo: true }],
}]);
eq(rows.length, 3, 'report：行数');
eq(rows[0][5], '成功', 'report：成功状态');
eq(rows[1][5], '失败', 'report：失败状态');
eq(rows[2][5], '已撤销', 'report：撤销后状态覆盖成功');
eq(rows[0].slice(1, 5), ['按扩展名', 'Demos', 'a.pdf', 'pdf'], 'report：规则/根/文件/去向');
eq(FB.reportRows([]), [], 'report：空记录');

/* ---------------------------------------------------------------- 输出 */
console.log('');
console.log(`folder-core 单元测试：${pass + failures.length} 项，通过 ${pass} 项`);
if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('✓ 全部通过：规则分桶 / 计划汇总 / 归类报告');
