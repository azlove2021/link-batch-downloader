/* ============ 重复文件查找 · 纯函数核心 ============
 * 内容重复：先按大小分组（大小不同必不重复），组内再哈希 —— 分组逻辑在这里。
 * 保留哪个副本（pickKeeper）必须稳定可预期：层级最浅 > 路径最短 > 字典序。
 * 相似文件名：复用 data-core 的 fuzzyNormalize/similarity（Dice），排序后只比
 * 邻域窗口，避免 O(n²) 爆炸。单测：tests/dup-core.test.cjs。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* files: [{size, ...}] → [[idx,...], ...] 只返回成员 ≥2 的同大小组 */
  function groupBySize(files) {
    var bySize = {};
    (files || []).forEach(function (f, i) {
      var s = (f && f.size) || 0;
      if (!bySize[s]) bySize[s] = [];
      bySize[s].push(i);
    });
    return Object.keys(bySize)
      .filter(function (k) { return bySize[k].length > 1; })
      .map(function (k) { return bySize[k]; });
  }

  function depth(p) { return String(p == null ? '' : p).split(/[\\/]/).length; }

  /* 组内选「保留哪个」：层级最浅 > 路径最短 > 字典序（结果稳定、可复现） */
  function pickKeeper(group) {
    var best = 0;
    for (var i = 1; i < (group || []).length; i++) {
      var a = group[i], b = group[best];
      var da = depth(a && a.path), db = depth(b && b.path);
      if (da !== db) { if (da < db) best = i; continue; }
      var la = String(a && a.path || '').length, lb = String(b && b.path || '').length;
      if (la !== lb) { if (la < lb) best = i; continue; }
      if (String(a && a.path || '') < String(b && b.path || '')) best = i;
    }
    return best;
  }

  /* 相似文件名配对：按去扩展名的归一化名排序，只比较邻域 window 个。
   * files: [{name, ...}]；返回 [{a, b, score}]（a/b 是 files 的原始下标，a<b） */
  function similarNamePairs(files, opts) {
    opts = opts || {};
    var threshold = opts.threshold == null ? 0.88 : opts.threshold;
    var win = opts.window || 10;
    var DC = TB.dataCore;
    if (!DC || !DC.similarity) return [];
    var arr = [];
    (files || []).forEach(function (f, i) {
      var name = String((f && f.name) || '');
      var base = name.replace(/\.[^.]+$/, '');
      var key = DC.fuzzyNormalize ? DC.fuzzyNormalize(base) : base.toLowerCase();
      if (key) arr.push({ i: i, name: name, key: key });
    });
    arr.sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : 0; });
    var pairs = [];
    for (var a = 0; a < arr.length; a++) {
      for (var b = a + 1; b < Math.min(arr.length, a + 1 + win); b++) {
        var s = DC.similarity(arr[a].name, arr[b].name);
        if (s >= threshold) pairs.push({ a: arr[a].i, b: arr[b].i, score: s });
      }
    }
    return pairs;
  }

  TB.dupCore = {
    groupBySize: groupBySize,
    pickKeeper: pickKeeper,
    similarNamePairs: similarNamePairs,
  };
})();
