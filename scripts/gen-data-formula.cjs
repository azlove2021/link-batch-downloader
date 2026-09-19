const fs = require('fs');
const path = require('path');
const MARK_JS = "String.fromCharCode(1)";
const out = `/* 纯函数：公式列 + 交叉表（无 DOM） */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});
  var core = TB.dataCore || (TB.dataCore = {});
  var MARK = ${MARK_JS};

  function parseFormula(formula, headers) {
    headers = headers || [];
    var s = String(formula == null ? '' : formula).trim();
    if (!s) return { ok: false, err: '公式为空' };
    var eq = s.indexOf('=');
    if (eq < 0) return { ok: false, err: '公式应写成：新列名 = 表达式（如 税额 = 金额 * 0.13）' };
    var name = s.slice(0, eq).trim();
    var expr = s.slice(eq + 1).trim();
    if (!name) return { ok: false, err: '缺少新列名（等号左边）' };
    if (!expr) return { ok: false, err: '缺少表达式（等号右边）' };
    var refs = [], seen = Object.create(null), out = expr;

    out = out.replace(/\\[([^\\]]+)\\]/g, function (_, col) {
      var c = String(col).trim();
      if (!seen[c]) { seen[c] = 1; refs.push(c); }
      return MARK + c + MARK;
    });

    var names = headers.slice().sort(function (a, b) { return b.length - a.length; });
    names.forEach(function (c) {
      if (!c || seen[c]) return;
      var escd = c.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      var re = new RegExp('(^|[^\\\\w\\\\u4e00-\\\\u9fa5])' + escd + '($|[^\\\\w\\\\u4e00-\\\\u9fa5])', 'g');
      out = out.replace(re, function (m, a, b) {
        seen[c] = 1; refs.push(c);
        return a + MARK + c + MARK + b;
      });
    });

    var parts = out.split(MARK);
    var body = '';
    for (var i = 0; i < parts.length; i++) {
      body += (i % 2 === 1) ? 'V' : parts[i];
    }
    if (!/^[0-9 .+\\-*/()V]+$/.test(body)) {
      return { ok: false, err: '表达式里只允许：列名、数字、+ - * / 和括号' };
    }
    var missing = refs.filter(function (c) { return headers.indexOf(c) < 0; });
    if (missing.length) {
      return { ok: false, err: '找不到列：' + missing.join('、') };
    }
    return { ok: true, name: name, expr: expr, refs: refs, compiled: out };
  }

  function cellNum(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[¥￥,，\\s元%％]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function evalFormula(compiled, row, headers) {
    if (!compiled) return null;
    var parts = compiled.split(MARK);
    var expr = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var idx = headers.indexOf(parts[i]);
        expr += idx < 0 ? '0' : String(cellNum(row[idx]));
      } else {
        expr += parts[i];
      }
    }
    if (!/^[0-9 .+\\-*/()]+$/.test(expr)) return null;
    try {
      var v = Function('return (' + expr + ')')();
      if (typeof v !== 'number' || !isFinite(v)) return null;
      return Math.round(v * 1e8) / 1e8;
    } catch (e) {
      return null;
    }
  }

  function applyFormulaColumn(data, formula) {
    var p = parseFormula(formula, data.headers);
    if (!p.ok) return p;
    var idx = data.headers.indexOf(p.name);
    var headers = data.headers.slice();
    if (idx < 0) { headers.push(p.name); idx = headers.length - 1; }
    var rows = data.rows.map(function (r) {
      var v = evalFormula(p.compiled, r, data.headers);
      var row = r.slice();
      while (row.length < idx) row.push('');
      row[idx] = v == null ? '' : v;
      if (row.length > headers.length) row.length = headers.length;
      return row;
    });
    var bad = 0;
    rows.forEach(function (r) { if (r[idx] === '') bad++; });
    return { ok: true, headers: headers, rows: rows, name: p.name, bad: bad, refs: p.refs };
  }

  function crosstab(data, rowCol, colCol, valCol, op) {
    op = op || 'sum';
    var acc = Object.create(null);
    var rKeys = [], rSeen = Object.create(null);
    var cKeys = [], cSeen = Object.create(null);
    data.rows.forEach(function (r) {
      var rk = String(r[rowCol] == null ? '' : r[rowCol]).trim() || '(空)';
      var ck = String(r[colCol] == null ? '' : r[colCol]).trim() || '(空)';
      if (!rSeen[rk]) { rSeen[rk] = 1; rKeys.push(rk); }
      if (!cSeen[ck]) { cSeen[ck] = 1; cKeys.push(ck); }
      var cell = acc[rk] || (acc[rk] = Object.create(null));
      var c = cell[ck] || (cell[ck] = { n: 0, sum: 0, min: Infinity, max: -Infinity });
      c.n++;
      if (op !== 'count') {
        var v = cellNum(r[valCol]);
        c.sum += v;
        if (v < c.min) c.min = v;
        if (v > c.max) c.max = v;
      }
    });
    function agg(c) {
      if (!c) return 0;
      if (op === 'count') return c.n;
      if (op === 'avg') return c.n ? c.sum / c.n : 0;
      if (op === 'min') return c.min === Infinity ? 0 : c.min;
      if (op === 'max') return c.max === -Infinity ? 0 : c.max;
      return c.sum;
    }
    var cells = rKeys.map(function (rk) {
      return cKeys.map(function (ck) {
        var v = agg(acc[rk] && acc[rk][ck]);
        return Math.round(v * 1e6) / 1e6;
      });
    });
    var rowTotals = cells.map(function (row) {
      var s = 0;
      row.forEach(function (b) { s += b; });
      return Math.round(s * 1e6) / 1e6;
    });
    var colTotals = cKeys.map(function (_, ci) {
      var s = 0;
      cells.forEach(function (row) { s += row[ci]; });
      return Math.round(s * 1e6) / 1e6;
    });
    var grand = 0;
    rowTotals.forEach(function (x) { grand += x; });
    return {
      rowLabels: rKeys,
      colLabels: cKeys,
      cells: cells,
      rowTotals: rowTotals,
      colTotals: colTotals,
      grand: Math.round(grand * 1e6) / 1e6,
      op: op
    };
  }

  core.parseFormula = parseFormula;
  core.evalFormula = evalFormula;
  core.applyFormulaColumn = applyFormulaColumn;
  core.crosstab = crosstab;
})();
`;
const dest = path.join(__dirname, '..', 'js', 'data-formula.js');
fs.writeFileSync(dest, out);
console.log('wrote', dest, fs.statSync(dest).size);
