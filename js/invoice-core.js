/* ============ 发票 · 纯函数核心（重复检测 / 台账比对） ============
 * 抽成独立文件的原因：重复报销是真实事故，「台账里有没有这张票」也不能靠肉眼。
 * 归一化和匹配规则放在这里，可以不带浏览器直接跑单元测试
 * （tests/invoice-core.test.cjs）。UI 层（js/invoice.js）只负责接线。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* 发票号码归一化：只留数字和字母并转大写。
   * OCR 结果常混入空格 / 全角字符 / 「No.」前缀，比对前先归一。 */
  function normNumber(s) {
    return String(s == null ? '' : s).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  }

  /* 重复检测：按归一化发票号分组。
   * 返回 { 归一化号码 → [记录下标…] }，只含 ≥2 条的组（即真的重复）。
   * 没有号码的记录不参与（无法判定重复）。 */
  function findDuplicates(records) {
    var byNum = {};
    (records || []).forEach(function (r, i) {
      var n = normNumber(r && r.number);
      if (!n) return;
      (byNum[n] = byNum[n] || []).push(i);
    });
    var out = {};
    Object.keys(byNum).forEach(function (n) {
      if (byNum[n].length >= 2) out[n] = byNum[n];
    });
    return out;
  }

  /* 从台账表格（二维数组）建索引：
   *   exact —— 归一化后 ≥8 位的单元格值集合（发票号码最少 8 位，短值易误配）
   *   cells —— 原始字符串列表，用于兜底子串匹配（如台账格写「No.24312000000123」） */
  function buildLedger(rows) {
    var exact = Object.create(null);
    var cells = [];
    (rows || []).forEach(function (row) {
      (row || []).forEach(function (cell) {
        if (cell == null) return;
        var s = String(cell).trim();
        if (!s) return;
        cells.push(s);
        var n = normNumber(s);
        if (n.length >= 8) exact[n] = true;
      });
    });
    return { exact: exact, cells: cells };
  }

  /* 单张发票 ↔ 台账：先精确匹配，再子串包含（号码 ≥8 位才做子串，防误配） */
  function inLedger(ledger, number) {
    var n = normNumber(number);
    if (!n || !ledger) return false;
    if (ledger.exact[n]) return true;
    if (n.length < 8) return false;
    for (var i = 0; i < ledger.cells.length; i++) {
      if (ledger.cells[i].toUpperCase().indexOf(n) >= 0) return true;
    }
    return false;
  }

  /* 批量比对：返回与 records 对齐的 [true 在册 / false 没有 / null 无号码] */
  function matchLedger(ledger, records) {
    return (records || []).map(function (r) {
      var n = normNumber(r && r.number);
      if (!n) return null;
      return inLedger(ledger, n);
    });
  }

  TB.invoiceCore = {
    normNumber: normNumber,
    findDuplicates: findDuplicates,
    buildLedger: buildLedger,
    inLedger: inLedger,
    matchLedger: matchLedger,
  };
})();
