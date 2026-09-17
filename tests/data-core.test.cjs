#!/usr/bin/env node
/* ============================================================================
 * 数据工作台 · 纯函数单元测试
 *
 * 覆盖多表合并（按列名对齐）、按列拆表分组、对账模糊匹配。
 * 这些是「改错了会静默出错数据」的地方，必须逐个用例盯住。
 *
 * 运行： npm test
 * ==========================================================================*/
'use strict';

const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'js', 'data-core.js'));
const C = global.TB.dataCore;

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
}

/* ============================================================ 多表合并 === */

/* 表头一致：直接上下拼接 */
{
  const t1 = { name: '1月.csv', headers: ['部门', '金额'], rows: [['销售', '100'], ['技术', '200']] };
  const t2 = { name: '2月.csv', headers: ['部门', '金额'], rows: [['销售', '150']] };
  const m = C.mergeTables([t1, t2]);
  eq(m.headers, ['部门', '金额'], '合并且表头一致 → 保持原表头');
  eq(m.rows.length, 3, '合并且行数 = 2 + 1');
  eq(m.rows[2], ['销售', '150'], '第二张表的行接在后面');
  eq(m.warnings.length, 0, '表头一致时不应有警告');
  eq(m.stats.map((s) => s.rows), [2, 1], '统计每张表贡献的行数');
}

/* 列顺序不同：必须按列名对齐，而不是按位置 */
{
  const t1 = { name: 'a.csv', headers: ['部门', '金额'], rows: [['销售', '100']] };
  const t2 = { name: 'b.csv', headers: ['金额', '部门'], rows: [['999', '技术']] };
  const m = C.mergeTables([t1, t2]);
  eq(m.headers, ['部门', '金额'], '列顺序不同 → 结果沿用基准顺序');
  eq(m.rows[1], ['技术', '999'], '按列名对齐（不是按位置拼接）');
  eq(m.warnings.length, 0, '仅顺序不同不该报警告');
}

/* 缺列：留空并警告 */
{
  const t1 = { name: 'a.csv', headers: ['部门', '金额', '备注'], rows: [['销售', '100', 'x']] };
  const t2 = { name: 'b.csv', headers: ['部门', '金额'], rows: [['技术', '200']] };
  const m = C.mergeTables([t1, t2]);
  eq(m.rows[1], ['技术', '200', ''], '缺少的列留空');
  /* 列数不同 + 缺少列 各报一条，两条都有用（一条说列数、一条说具体缺哪列） */
  eq(m.warnings.length, 2, '列数不同与缺列各产生 1 条警告');
  eq(m.warnings.some((w) => /缺少列/.test(w) && /b\.csv/.test(w)), true,
     '应有一条警告指出 b.csv 缺哪一列');
}

/* 多列：并入结果 */
{
  const t1 = { name: 'a.csv', headers: ['部门'], rows: [['销售']] };
  const t2 = { name: 'b.csv', headers: ['部门', '区域'], rows: [['技术', '华东']] };
  const m = C.mergeTables([t1, t2]);
  eq(m.headers, ['部门', '区域'], '多出的列并入结果');
  eq(m.rows[0], ['销售', ''], '基准表在该列留空');
  eq(m.rows[1], ['技术', '华东'], '另一表的该列有值');
}

/* 来源文件列 */
{
  const t1 = { name: '1月.csv', headers: ['部门'], rows: [['销售']] };
  const t2 = { name: '2月.csv', headers: ['部门'], rows: [['技术']] };
  const m = C.mergeTables([t1, t2], { addSource: true });
  eq(m.headers, ['部门', '来源文件'], '开启后追加剧来源列');
  eq(m.rows.map((r) => r[1]), ['1月.csv', '2月.csv'], '来源文件列写入各自文件名');
}

/* 全空行应被跳过，否则合并结果全是空行 */
{
  const t1 = { name: 'a.csv', headers: ['a'], rows: [['1'], ['', ''], ['2']] };
  const m = C.mergeTables([t1]);
  eq(m.rows.length, 2, '整行为空的行不并入');
  eq(m.stats[0].skipped, 1, '统计里记录跳过的空行数');
}

/* 同表内列名重复要警告（后一列会覆盖前一列） */
{
  const t1 = { name: 'a.csv', headers: ['金额', '金额'], rows: [['1', '2']] };
  const m = C.mergeTables([t1]);
  eq(m.warnings.some((w) => /同名列/.test(w)), true, '同表内重复表头应警告');
}

/* 空表头兜底 */
{
  const t1 = { name: 'a.csv', headers: ['', '金额'], rows: [['x', '1']] };
  const m = C.mergeTables([t1]);
  eq(m.headers, ['列1', '金额'], '空表头自动补「列N」');
}

/* ============================================================ 按列拆表 === */
{
  const rows = [
    ['华东', 'a'], ['华北', 'b'], ['华东', 'c'], ['华南', 'd'], ['华北', 'e'],
  ];
  const g = C.groupRowsBy(rows, 0);
  eq(g.map((x) => x.key), ['华东', '华北', '华南'], '分组保持首次出现顺序');
  eq(g.map((x) => x.count), [2, 2, 1], '每组行数正确');
  eq(g[0].rows.map((r) => r[1]), ['a', 'c'], '组内保留原始行');
}
{
  const rows = [['', 'x'], ['  ', 'y'], ['A', 'z']];
  const g = C.groupRowsBy(rows, 0);
  eq(g[0].key, '(空值)', '空值与纯空格归为同一组');
  eq(g[0].count, 2, '空值组合并计数');
}
{
  const groups = [
    { key: '华东/北', count: 1 }, { key: '华东:北', count: 1 }, { key: '华东_北', count: 1 },
  ];
  const names = C.uniqueNames(groups);
  eq(names.map((n) => n.name), ['华东_北.csv', '华东_北_2.csv', '华东_北_3.csv'],
     '非法字符替换后重名要自动加序号，避免互相覆盖');
}
{
  eq(C.safeFileName('  a.b.  '), 'a.b', '去掉首尾空格与结尾的点（Windows 不允许）');
  eq(C.safeFileName(''), '(空值)', '空文件名兜底');
  eq(C.safeFileName('x'.repeat(200)).length, 80, '过长文件名截断到 80 字符');
}

/* ========================================================== 模糊匹配 === */
{
  eq(C.fuzzyNormalize('北京 某某 有限公司'), C.fuzzyNormalize('北京某某有限责任公司'),
     '空格差异 + 有限责任公司/有限公司 应视为同一');
  eq(C.fuzzyNormalize('ＡＢＣ－１２３'), C.fuzzyNormalize('abc-123'),
     '全角字母数字应归一');
  eq(C.fuzzyNormalize('上海（集团）'), C.fuzzyNormalize('上海集团'),
     '括号差异应归一');
}
{
  const near = C.similarity('北京某某科技有限公司', '北京某某科技有限责任公司');
  eq(near > 0.8, true, '相近名称相似度应 > 0.8（实际 ' + near.toFixed(3) + '）');
  const far = C.similarity('北京某某科技有限公司', '广州天马物流公司');
  eq(far < 0.4, true, '无关名称相似度应 < 0.4（实际 ' + far.toFixed(3) + '）');
  eq(C.similarity('同一个', '同一个'), 1, '完全相同 → 1');
  eq(C.similarity('', 'x'), 0, '空字符串 → 0');
}

/* ======================================================== 清洗管线 === */
function pipe(headers, rows, steps, limit) { return C.applyPipeline(headers, rows, steps, limit); }
function step(op, colName, arg, arg2) {
  return { op: op, colName: colName, col: 0, arg: arg, arg2: arg2 };
}

/* 单步：日期规范化，且认不出的日期要原样保留（不能清空） */
{
  const H = ['日期', '名称'];
  const r = pipe(H, [['2024/1/5', 'a'], ['2024.01.06', 'b'], ['20240107', 'c'],
                     ['不是日期', 'd'], ['2024-02-30', 'e']],
    [step('date', '日期')]);
  eq(r.rows.map((x) => x[0]), ['2024-01-05', '2024-01-06', '2024-01-07', '不是日期', '2024-02-30'],
    '日期规范化：能认的转 YYYY-MM-DD，认不出的原样保留');
}
/* 金额去符号 */
{
  const r = pipe(['金额'], [['¥1,234.50'], ['1234元'], ['（空）'], ['-88.8']], [step('number', '金额')]);
  eq(r.rows.map((x) => x[0]), ['1234.50', '1234', '（空）', '-88.8'],
    '金额去符号：只处理含数字的，纯文字不动');
}
/* 多步串联 + 顺序无关性验证（trim 再 replace） */
{
  const H = ['部门', '人名'];
  const r = pipe(H, [['  销售部 ', ' 张 三 '], ['销售部', '李四']], [
    step('trim'), step('replace', '部门', '销售部', '销售'),
  ]);
  eq(r.rows[0], ['销售', '张 三'], 'trim 后再查找替换，按顺序生效');
}
/* 替换：按列不选错列 */
{
  const r = pipe(['A', 'B'], [['x', 'x']], [step('replace', 'B', 'x', 'y')]);
  eq(r.rows[0], ['x', 'y'], '查找替换只作用于选定的列');
}
/* 空值填标记 */
{
  const r = pipe(['A', 'B'], [['', 'x'], [null, '']], [step('fill', 'A', '待补')]);
  eq(r.rows.map((x) => x[0]), ['待补', '待补'], '空值填统一标记');
}
/* 整行去重 / 删空行 / 删本列为空 */
{
  const r = pipe(['A', 'B'], [['1', '2'], ['1', '2'], ['', ''], ['3', '']], [step('dedupe')]);
  eq(r.rows.length, 3, '整行去重：3 行唯一（含 1 条空行）');
  const r2 = pipe(['A', 'B'], [['1', '2'], ['', ''], ['3', '']], [step('dropEmpty')]);
  eq(r2.rows.length, 2, '删除整行为空的行');
  const r3 = pipe(['A', 'B'], [['1', '2'], ['', ''], ['3', '']], [step('dropBlank', 'B')]);
  eq(r3.rows.length, 1, '删除本列为空的行（B 为空的两行被删，只剩 1 行）');
}
/* 拆列：表头跟着变，且列数不漂移 */
{
  const r = pipe(['区域', '金额'], [['华东|上海', '10'], ['华北|北京', '20']], [step('split', '区域', '|')]);
  eq(r.headers, ['区域_拆1', '区域_拆2', '金额'], '拆列后表头改名并插入新列');
  eq(r.rows[0], ['华东', '上海', '10'], '拆列后数据对位正确');
}
/* 拆列后再引用原列名的步骤应被识别为「找不到列」而不是默默改错列 */
{
  const r = pipe(['区域'], [['a|b']], [step('split', '区域', '|'), step('number', '区域')]);
  eq(r.logs.length, 1, '原列已被拆掉，后续步骤应记录一条跳过说明');
  eq(r.rows[0], ['a', 'b'], '跳过的步骤不破坏数据');
}
/* 合列 */
{
  const r = pipe(['部门', '人名'], [['销售部', '张三']], [step('merge', '部门', '/', '人名')]);
  eq(r.headers, ['部门+人名'], '合列后两列并成一列');
  eq(r.rows[0], ['销售部/张三'], '合列按连接符拼接');
}
/* 列名对不上时必须跳过，绝不能按序号改错列 */
{
  const r = pipe(['旧名', '另一列'], [['', '']],
    [{ op: 'fill', col: 1, colName: '已不存在的名字', arg: 'X' }]);
  eq(r.rows[0], ['', ''], '列名找不到 → 整步跳过，一格都不改');
  eq(r.logs.length, 1, '并且记录一条跳过说明');
  const ok = pipe(['旧名', '另一列'], [['', '']], [{ op: 'fill', col: 1, arg: 'X' }]);
  eq(ok.rows[0], ['', 'X'], '没给列名时才按序号定位');
  /* trim 是整行操作，不该受列名影响 */
  const t2 = pipe(['旧名'], [['  x  ']], [{ op: 'trim', col: 1, colName: '不存在的名字' }]);
  eq(t2.rows[0], ['x'], '整行操作不需要列，不存在找不到列的问题');
}
/* 预览只截断、不改动总行数统计 */
{
  const big = [];
  for (let i = 0; i < 500; i++) big.push([String(i)]);
  const r = pipe(['n'], big, [step('trim')], 20);
  eq(r.rows.length, 20, 'limit 只影响返回行数');
  eq(r.total, 500, 'total 仍然是全部行数');
}
/* 未知操作不能炸 */
{
  const r = pipe(['n'], [['1']], [step('不存在的操作', 'n')]);
  eq(r.rows[0], ['1'], '未知操作被跳过，数据不受影响');
  eq(r.logs.length, 1, '未知操作要记一条说明');
}

/* ==================================================== 对账键 / 相似 === */
{
  const opt = { ignoreCase: true, normalize: false };
  eq(C.cmpEq('ABC', 'abc', opt), true, '忽略大小写时 ABC = abc');
  eq(C.cmpEq('ABC', 'abc', {}), false, '不忽略大小写时 ABC ≠ abc');
  eq(C.cmpEq(' 1 ', '1', {}), true, '两端空白差异不构成差异');
  eq(C.cmpEq('北京（集团）', '北京集团', { normalize: true }), true,
    '开启归一化后括号差异不算差异');
  eq(C.cmpKey('', { normalize: true }), '', '空值归一化后仍为空（不参与匹配）');
}

/* =============================================== 预览表格（HTML 安全） == */
{
  const h = C.tableHtml(['<b>列</b>'], [['<script>x</script>']], 5);
  eq(h.indexOf('<b>列</b>') < 0, true, '表头 HTML 必须被转义');
  eq(h.indexOf('<script>') < 0, true, '单元格内容必须被转义');
  eq(h.indexOf('共 1 行') < 0, true, '行数不超过 limit 时不显示额外提示');
}

/* ================================================================ 输出 == */
console.log('');
console.log(`数据核心测试：${pass + failures.length} 项，通过 ${pass} 项`);
console.log('');
if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}
console.log('✓ 全部通过：多表合并 / 按列拆表 / 模糊匹配');

