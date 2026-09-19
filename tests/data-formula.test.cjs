'use strict';
var path = require('path');
global.window = global;
require(path.join(__dirname, '..', 'js', 'data-core.js'));
require(path.join(__dirname, '..', 'js', 'data-formula.js'));
var C = global.TB.dataCore;
var failed = 0;
function ok(name, cond, extra) {
  if (!cond) { failed++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
  else { console.log('  ok   ' + name); }
}

var headers = ['工号', '部门', '销售额'];
var rows = [
  ['E1', '销售部', '1000'],
  ['E2', '市场部', '¥2,500'],
  ['E3', '销售部', '800'],
];
var data = { headers: headers, rows: rows };

// parse
var p1 = C.parseFormula('税额 = [销售额] * 0.13', headers);
ok('parse formula', p1.ok && p1.name === '税额' && p1.refs[0] === '销售额', p1.err);
var p2 = C.parseFormula('合计 = 销售额 * 2', headers);
ok('bare col name', p2.ok, p2.err);
var p3 = C.parseFormula('坏 = a + b', headers);
ok('missing col err', !p3.ok, JSON.stringify(p3));
var p4 = C.parseFormula('x + 1', headers);
ok('no equals err', !p4.ok);
var p5 = C.parseFormula('evil = [销售额]; alert(1)', headers);
ok('reject code inject', !p5.ok, p5.err);

// eval
var v = C.evalFormula(p1.compiled, rows[1], headers);
ok('eval zh number', v === 325, String(v));

// apply column
var r = C.applyFormulaColumn(data, '税额 = [销售额] * 0.13');
ok('apply formula', r.ok && r.headers.length === 4 && r.rows.length === 3, r.err);
ok('formula value', r.rows[0][3] === 130, String(r.rows[0][3]));
ok('formula yuan parse', r.rows[1][3] === 325, String(r.rows[1][3]));

// crosstab
var headers2 = ['部门', '月份', '销售额'];
var rows2 = [
  ['A', '2024-01', '100'],
  ['A', '2024-02', '200'],
  ['B', '2024-01', '50'],
  ['A', '2024-01', '80'],
];
var xt = C.crosstab({ headers: headers2, rows: rows2 }, 0, 1, 2, 'sum');
ok('xt labels', xt.rowLabels.length === 2 && xt.colLabels.length === 2, JSON.stringify(xt.rowLabels) + JSON.stringify(xt.colLabels));
ok('xt a sum', xt.cells[0][0] === 180, String(xt.cells[0][0]));
ok('xt grand', xt.grand === 430, String(xt.grand));
var xtCount = C.crosstab({ headers: headers2, rows: rows2 }, 0, 1, 2, 'count');
ok('xt count', xtCount.cells[0][0] === 2, String(xtCount.cells[0][0]));
var xtAvg = C.crosstab({ headers: headers2, rows: rows2 }, 0, 1, 2, 'avg');
ok('xt avg', Math.abs(xtAvg.cells[0][0] - 90) < 0.001, String(xtAvg.cells[0][0]));

console.log(failed === 0 ? '公式/交叉表测试：全部通过' : ('公式/交叉表失败 ' + failed + ' 项'));
process.exit(failed ? 1 : 0);
