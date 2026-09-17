#!/usr/bin/env node
/* ============================================================================
 * 发票 · 纯函数单元测试（重复检测 / 台账比对）
 *
 * 重复报销是真实事故，台账比对不能靠肉眼。这里盯住归一化与匹配的边界：
 * OCR 变体（空格/前缀）要认得出是同一张票，短数字不能误配。
 *
 * 运行： npm test（会连同一致性校验一起跑）
 * ==========================================================================*/
'use strict';

const path = require('path');

/* 让浏览器风格的 IIFE 能在 Node 里加载 */
global.window = global;
require(path.join(__dirname, '..', 'js', 'invoice-core.js'));
const IC = global.TB.invoiceCore;

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
}

/* ---------------------------------------------------------------- 归一化 */
eq(IC.normNumber(' 1234 5678 '), '12345678', '去空格');
eq(IC.normNumber('No.24312000000123'), 'NO24312000000123', '字母保留并大写');
eq(IC.normNumber('２４３１２'), '', '全角字符会被过滤（先经 text-core 全角转半角再归一）');
eq(IC.normNumber(null), '', 'null 安全');

/* ---------------------------------------------------------------- 重复检测 */
const recs = [
  { number: '12345678' },
  { number: '1234 5678' },   // OCR 空格变体 → 同一张票
  { number: '87654321' },
  { number: '' },
];
eq(IC.findDuplicates(recs), { '12345678': [0, 1] }, '重复号归组（归一化后），无号码不参与');
eq(IC.findDuplicates([{ number: '111' }, { number: '111' }, { number: '111' }]),
   { '111': [0, 1, 2] }, '三连重复给出全部下标');
eq(IC.findDuplicates([]), {}, '空列表');

/* ---------------------------------------------------------------- 台账比对 */
const ledger = IC.buildLedger([
  ['发票号码', '金额'],
  ['24312000000123', '100.00'],
  ['No.99887766', '200.00'],
]);
eq(IC.inLedger(ledger, '24312000000123'), true, '精确匹配');
eq(IC.inLedger(ledger, '99887766'), true, '子串兜底（台账格带 No. 前缀）');
eq(IC.inLedger(ledger, '11112222'), false, '不在台账');
eq(IC.inLedger(ledger, ''), false, '空号码不匹配');
eq(IC.inLedger(IC.buildLedger([['备注', '12345']]), '12345678'), false, '短单元格不误配长号码');
eq(IC.matchLedger(ledger, [{ number: '24312000000123' }, { number: '000' }, { number: '' }]),
   [true, false, null], '批量比对：null=无号码，false=台账没有');

/* ---------------------------------------------------------------- 输出 */
console.log('');
console.log(`invoice-core 单元测试：${pass + failures.length} 项，通过 ${pass} 项`);
if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('✓ 全部通过：重复检测 / 台账比对');
