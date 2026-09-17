/* ============ 文件夹归类 · 纯函数核心（规则分桶 / 计划汇总 / 归类报告） ============
 * bucketFor 决定「一个文件该进哪个子文件夹」，归类对不对全看它；
 * reportRows 是「处理报告」的归类部分（改进建议 §3.6）。
 * 抽出来配单测（tests/folder-core.test.cjs），UI 层 js/folderorg.js 只负责接线。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* 按规则算出文件应归入的子文件夹名。
   * file: {name, size, lastModified(ms)}
   * mode: ext | yearmonth | year | keyword | prefix | size
   * kws : 关键字数组（keyword 模式用，先命中先得，未命中归「其他」） */
  function bucketFor(file, mode, kws) {
    var name = file.name;
    var ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase() || '无扩展名';
    if (mode === 'ext') return ext.replace('.', '') || '无扩展名';
    if (mode === 'yearmonth' || mode === 'year') {
      var d = file.lastModified ? new Date(file.lastModified) : null;
      if (!d) return '未知日期';
      var y = d.getFullYear();
      if (mode === 'year') return String(y);
      return y + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
    }
    if (mode === 'keyword') {
      var lower = name.toLowerCase();
      for (var i = 0; i < (kws || []).length; i++) {
        if (kws[i] && lower.indexOf(kws[i].toLowerCase()) >= 0) return kws[i];
      }
      return '其他';
    }
    if (mode === 'prefix') return name.slice(0, 2) || '其他';
    if (mode === 'size') {
      var mb = (file.size || 0) / (1024 * 1024);
      if (mb < 0.1) return '<100KB';
      if (mb < 1) return '100KB-1MB';
      if (mb < 10) return '1-10MB';
      if (mb < 100) return '10-100MB';
      return '>=100MB';
    }
    return '其他';
  }

  /* 计划 → 分组汇总（预览表用）：[{key, count, sample:[最多3个文件名]}]，按 key 中文排序 */
  function summarizePlan(plan) {
    var groups = {};
    (plan || []).forEach(function (p) {
      if (!p || !p.to) return;
      if (!groups[p.to]) groups[p.to] = [];
      groups[p.to].push(p.name);
    });
    return Object.keys(groups)
      .sort(function (a, b) { return a.localeCompare(b, 'zh'); })
      .map(function (k) {
        return { key: k, count: groups[k].length, sample: groups[k].slice(0, 3) };
      });
  }

  /* 归类记录 → 报告行（导出 CSV 用）。
   * logs: [{ts, mode, root, items:[{name, to, ok, undo}]}]
   * 返回 [[时间, 规则, 根文件夹, 文件名, 归入, 状态], ...] */
  function reportRows(logs) {
    var rows = [];
    (logs || []).forEach(function (g) {
      (g.items || []).forEach(function (it) {
        var status = it.ok === false ? '失败' : (it.undo === true ? '已撤销' : '成功');
        rows.push([new Date(g.ts).toLocaleString('zh-CN'), g.mode || '', g.root || '',
                   it.name || '', it.to || '', status]);
      });
    });
    return rows;
  }

  TB.folderCore = {
    bucketFor: bucketFor,
    summarizePlan: summarizePlan,
    reportRows: reportRows,
  };
})();
