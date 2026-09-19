/* ============ 数据工作台 · 纯函数核心 ============
 * 多表合并、按列拆表、对账模糊匹配这些逻辑放在这里，
 * 不依赖 DOM、不依赖 XLSX，可以在 Node 里直接跑单元测试
 * （tests/data-core.test.cjs）。UI 部分见 js/data-batch.js。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* ------------------------------------------------------------ 表头处理 -- */

  function normHeader(h, i) {
    var s = String(h == null ? '' : h).trim();
    return s || ('列' + (i + 1));
  }

  /**
   * 合并前先体检：以第一张表为基准，报告各表表头差异。
   * @param {Array<{name,headers,rows}>} tables
   * @returns {{warnings:string[], union:string[], columns:number}}
   */
  function planMerge(tables) {
    var warnings = [];
    if (!tables.length) return { warnings: ['没有可合并的表'], union: [], columns: 0 };

    var union = [];
    var seen = Object.create(null);
    tables.forEach(function (t) {
      t.headers.forEach(function (h, i) {
        var key = normHeader(h, i);
        if (!(key in seen)) { seen[key] = true; union.push(key); }
      });
    });

    var base = tables[0];
    tables.forEach(function (t, ti) {
      var tag = (ti === 0 ? '' : '「' + t.name + '」');
      if (ti > 0) {
        if (t.headers.length !== base.headers.length) {
          warnings.push(tag + '列数不同：基准 ' + base.headers.length + ' 列，本表 ' + t.headers.length + ' 列');
        }
        var miss = base.headers.filter(function (h, i) {
          return t.headers.map(function (x, j) { return normHeader(x, j); })
            .indexOf(normHeader(h, i)) < 0;
        });
        var extra = t.headers.filter(function (h, i) {
          return base.headers.map(function (x, j) { return normHeader(x, j); })
            .indexOf(normHeader(h, i)) < 0;
        });
        if (miss.length) warnings.push(tag + '缺少列：' + miss.join('、') + '（该列将留空）');
        if (extra.length) warnings.push(tag + '多出列：' + extra.join('、') + '（将并入结果）');
      }
      /* 同一张表里重名的列会导致后一列覆盖前一列，必须提醒 */
      var dup = {};
      t.headers.forEach(function (h, i) {
        var key = normHeader(h, i);
        dup[key] = (dup[key] || 0) + 1;
      });
      var dupNames = Object.keys(dup).filter(function (k) { return dup[k] > 1; });
      if (dupNames.length) warnings.push(tag + '存在同名列表头：' + dupNames.join('、') + '（数据可能被覆盖）');
    });

    return { warnings: warnings, union: union, columns: union.length };
  }

  /**
   * 多表上下合并：按列名对齐（不是按位置），缺列填空，多列并入。
   * @param {Array<{name,headers,rows}>} tables
   * @param {{addSource?:boolean, sourceHeader?:string}} [opts]
   * @returns {{headers:string[], rows:Array[], warnings:string[], stats:Array}}
   */
  function mergeTables(tables, opts) {
    opts = opts || {};
    var plan = planMerge(tables);
    var headers = plan.union.slice();
    var colOf = Object.create(null);
    headers.forEach(function (h, i) { colOf[h] = i; });

    var rows = [];
    var stats = [];

    tables.forEach(function (t) {
      var map = t.headers.map(function (h, i) { return colOf[normHeader(h, i)]; });
      var added = 0, skipped = 0;
      t.rows.forEach(function (r) {
        /* 整行为空的行不并进来，否则合并结果里全是空行 */
        var hasValue = false;
        for (var c = 0; c < r.length; c++) {
          if (r[c] != null && String(r[c]) !== '') { hasValue = true; break; }
        }
        if (!hasValue) { skipped++; return; }

        var out = new Array(headers.length);
        for (var i = 0; i < headers.length; i++) out[i] = '';
        for (var c2 = 0; c2 < map.length; c2++) {
          if (map[c2] < 0) continue;
          out[map[c2]] = r[c2] == null ? '' : String(r[c2]);
        }
        if (opts.addSource) out.push(t.name);
        rows.push(out);
        added++;
      });
      stats.push({ name: t.name, rows: added, skipped: skipped, cols: t.headers.length });
    });

    var outHeaders = headers.slice();
    if (opts.addSource) outHeaders.push(opts.sourceHeader || '来源文件');

    return { headers: outHeaders, rows: rows, warnings: plan.warnings, stats: stats };
  }

  /* ------------------------------------------------------------ 按列拆表 -- */

  /* 文件名安全化：去掉非法字符、过长截断、空值兜底 */
  function safeFileName(s, fallback) {
    var t = String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '');   // Windows 不允许文件名以点或空格结尾
    if (!t) t = fallback || '(空值)';
    if (t.length > 80) t = t.slice(0, 80);
    return t;
  }

  /**
   * 按某列的值分组（保持首次出现顺序，便于预览稳定）。
   * @returns {Array<{key:string, rows:Array[], count:number}>}
   */
  function groupRowsBy(rows, colIndex) {
    var order = [];
    var map = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i][colIndex];
      var key = String(raw == null ? '' : raw).trim();
      if (!key) key = '(空值)';
      if (!(key in map)) {
        map[key] = { key: key, rows: [], count: 0 };
        order.push(key);
      }
      map[key].rows.push(rows[i]);
      map[key].count++;
    }
    return order.map(function (k) { return map[k]; });
  }

  /** 分组重名时给文件名加序号，避免互相覆盖 */
  function uniqueNames(groups) {
    var used = Object.create(null);
    return groups.map(function (g) {
      var base = safeFileName(g.key, '(空值)');
      var name = base;
      var n = 2;
      while (used[name.toLowerCase()]) { name = base + '_' + n; n++; }
      used[name.toLowerCase()] = true;
      return { key: g.key, name: name + '.csv', count: g.count };
    });
  }

  /* ---------------------------------------------------------- 对账模糊匹配 */

  /**
   * 归一化：用于「看起来不同、其实是同一个」的匹配。
   * 保守策略，只处理真实常见差异，不做过度推断。
   */
  function fuzzyNormalize(s) {
    var t = String(s == null ? '' : s).trim().toLowerCase();
    if (!t) return '';
    /* 全角→半角（数字/字母/常见符号） */
    t = t.replace(/[\uff01-\uff5e]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
    t = t.replace(/\u3000/g, ' ');
    /* 去掉所有空白与常见分隔/标点 */
    t = t.replace(/[\s\-_/\\.,;:!?'"()\[\]{}<>、。，；：！？「」『』【】]/g, '');
    /* 常见写法差异：有限责任公司 / 股份有限公司 统一成「有限公司」 */
    t = t.replace(/有限责任公司/g, '有限公司');
    t = t.replace(/股份有限公司/g, '有限公司');
    /* 常见的尾缀差异 */
    t = t.replace(/\(有限\)/g, '');
    return t;
  }

  /** 二元组 Dice 相似度，0~1。用于名称近似匹配。 */
  function similarity(a, b) {
    var x = fuzzyNormalize(a);
    var y = fuzzyNormalize(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (x.length < 2 || y.length < 2) return 0;

    var grams = function (s) {
      var m = Object.create(null);
      for (var i = 0; i < s.length - 1; i++) {
        var g = s.substr(i, 2);
        m[g] = (m[g] || 0) + 1;
      }
      return m;
    };
    var ga = grams(x), gb = grams(y);
    var inter = 0, total = 0;
    Object.keys(ga).forEach(function (g) {
      total += ga[g];
      if (gb[g]) inter += Math.min(ga[g], gb[g]);
    });
    Object.keys(gb).forEach(function (g) { total += gb[g]; });
    return total ? (2 * inter) / total : 0;
  }

  /* -------------------------------------------------------- 对账键与相等 -- */

  /** 匹配键：按选项归一化。用做字典的 key，也用于判断两值是否算「一致」。 */
  function cmpKey(s, opt) {
    var t = String(s == null ? '' : s).trim();
    if (!opt || !opt.normalize) return (opt && opt.ignoreCase) ? t.toLowerCase() : t;
    return fuzzyNormalize(t);
  }

  function cmpEq(a, b, opt) {
    return cmpKey(a, opt) === cmpKey(b, opt);
  }

  /* ---------------------------------------------------------- 清洗管线 --- */

  /* 每个操作：needsCol=是否需要选定列，args=需要几个参数，整行操作不选列 */
  var OPS = {
    trim:      { label: '去空格 / 压缩空白', needsCol: false, args: 0, row: true },
    date:      { label: '规范日期为 YYYY-MM-DD', needsCol: true, args: 0 },
    number:    { label: '金额去符号 / 千分位', needsCol: true, args: 0 },
    fill:      { label: '空单元格填统一标记', needsCol: true, args: 1, arg1: '填入内容', defaultArg: '—' },
    replace:   { label: '查找替换', needsCol: true, args: 2, arg1: '查找内容', arg2: '替换为' },
    split:     { label: '按分隔符拆成多列', needsCol: true, args: 1, arg1: '分隔符' },
    merge:     { label: '与另一列合并成一列', needsCol: true, args: 2, arg1: '连接符', arg2: '另一列的列名' },
    dedupe:    { label: '整行去重', needsCol: false, args: 0, row: true },
    dropEmpty: { label: '删除整行为空的行', needsCol: false, args: 0, row: true },
    dropBlank: { label: '删除本列为空的行', needsCol: true, args: 0 },
  };

  function needsArg(op) {
    return !!(OPS[op] && OPS[op].args > 0);
  }

  /** 运行时脚本用的中文说明，例如「规范日期（下单日期）」 */
  function describeStep(step, headers) {
    var o = OPS[step.op];
    if (!o) return '未知操作（' + step.op + '）';
    var name = step.colName || (headers && headers[step.col] != null ? String(headers[step.col]) : '第' + (step.col + 1) + '列');
    var s = o.label;
    if (o.needsCol) s += '（' + name + '）';
    if (step.op === 'split') s += '，分隔符「' + (step.arg || ',') + '」';
    if (step.op === 'merge') s += '，连接到「' + (step.arg2 || '') + '」，连接符「' + (step.arg || '') + '」';
    if (step.op === 'fill') s += '：' + (step.arg || '—');
    if (step.op === 'replace') s += '：「' + (step.arg || '') + '」→「' + (step.arg2 || '') + '」';
    return s;
  }

  /* 列定位：位置与列名都对得上就用位置（同名列时更准）；
     列名被上游步骤改掉/删掉时返回 -1 让调用方跳过 —— 宁可不动，也不能改错列 */
  function resolveCol(headers, step) {
    if (step.col != null && step.col >= 0 && step.col < headers.length &&
        (step.colName == null || String(headers[step.col]) === String(step.colName))) {
      return step.col;
    }
    if (step.colName != null) {
      var i = headers.indexOf(step.colName);
      return i >= 0 ? i : -1;
    }
    return (step.col >= 0 && step.col < headers.length) ? step.col : -1;
  }

  var DATE_RE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/;

  function normDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = s.match(DATE_RE) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3];
    if (!validYmd(y, mo, d)) return '';
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }

  function validYmd(y, m, d) {
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function cleanNumber(v) {
    /* ¥1,234.50 / 1234元 / 1 234,5 → 1234.5（保留负号与小数点） */
    var s = String(v == null ? '' : v).replace(/[¥￥,，\s元]/g, '');
    if (!/\d/.test(s)) return '';
    var t = s.replace(/[^\d.\-]/g, '');
    return t;
  }

  /**
   * 按顺序执行清洗步骤。
   * @param {string[]} headers 原始表头
   * @param {Array[]} rows 原始数据
   * @param {Array<{op,col,colName,arg,arg2}>} steps
   * @param {number} [limit] 只返回前 N 行（预览用）
   * @returns {{headers:string[], rows:Array[], total:number, logs:string[]}}
   */
  function applyPipeline(headers, rows, steps, limit) {
    var H = headers.slice();
    var out = rows.map(function (r) { return r.slice(); });
    var logs = [];

    steps.forEach(function (step, si) {
      var tag = '第' + (si + 1) + '步';
      var o = OPS[step.op];
      if (!o) { logs.push(tag + '：未知操作，已跳过'); return; }
      var ci = resolveCol(H, step);
      if (o.needsCol && ci < 0) {
        logs.push(tag + '（' + describeStep(step, H) + '）：找不到列，已跳过');
        return;
      }
      var i, r;

      if (step.op === 'trim') {
        for (i = 0; i < out.length; i++) {
          r = out[i];
          for (var c = 0; c < r.length; c++) {
            if (typeof r[c] !== 'string') continue;
            var t = r[c].replace(/^\s+|\s+$/g, '').replace(/[ \t]{2,}/g, ' ');
            if (t !== r[c]) r[c] = t;
          }
        }
      } else if (step.op === 'date') {
        for (i = 0; i < out.length; i++) {
          var nv = normDate(out[i][ci]);
          if (nv) out[i][ci] = nv;
        }
      } else if (step.op === 'number') {
        for (i = 0; i < out.length; i++) {
          var n2 = cleanNumber(out[i][ci]);
          if (n2 !== '' && n2 !== String(out[i][ci])) out[i][ci] = n2;
        }
      } else if (step.op === 'fill') {
        var mark = step.arg == null || step.arg === '' ? '—' : step.arg;
        for (i = 0; i < out.length; i++) {
          if (out[i][ci] === '' || out[i][ci] == null) out[i][ci] = mark;
        }
      } else if (step.op === 'replace') {
        var find = step.arg == null ? '' : String(step.arg);
        var repl = step.arg2 == null ? '' : String(step.arg2);
        if (find !== '') {
          for (i = 0; i < out.length; i++) {
            var v = String(out[i][ci] == null ? '' : out[i][ci]);
            if (v.indexOf(find) >= 0) out[i][ci] = v.split(find).join(repl);
          }
        } else { logs.push(tag + '：查找内容为空，已跳过'); }
      } else if (step.op === 'dropBlank') {
        out = out.filter(function (x) { return String(x[ci] == null ? '' : x[ci]).trim() !== ''; });
      } else if (step.op === 'dropEmpty') {
        out = out.filter(function (x) {
          return x.some(function (v) { return v != null && String(v).trim() !== ''; });
        });
      } else if (step.op === 'dedupe') {
        var seen = Object.create(null);
        var kept = [];
        for (i = 0; i < out.length; i++) {
          var key = out[i].join('\u0001');
          if (seen[key]) continue;
          seen[key] = 1; kept.push(out[i]);
        }
        out = kept;
      } else if (step.op === 'split') {
        var sep = step.arg == null || step.arg === '' ? ',' : String(step.arg);
        var maxN = 2;
        for (i = 0; i < out.length; i++) {
          var parts = String(out[i][ci] == null ? '' : out[i][ci]).split(sep);
          if (parts.length > maxN) maxN = parts.length;
        }
        var newH = [];
        for (var k = 0; k < maxN; k++) newH.push(H[ci] + '_拆' + (k + 1));
        out = out.map(function (x) {
          var ps = String(x[ci] == null ? '' : x[ci]).split(sep);
          while (ps.length < maxN) ps.push('');
          return x.slice(0, ci).concat(ps).concat(x.slice(ci + 1));
        });
        H = H.slice(0, ci).concat(newH).concat(H.slice(ci + 1));
      } else if (step.op === 'merge') {
        var other = step.arg2 == null ? '' : String(step.arg2);
        var oi = H.indexOf(other);
        if (oi < 0 || oi === ci) { logs.push(tag + '：找不到要合并的另一列「' + other + '」，已跳过'); return; }
        var joiner = step.arg == null ? '' : String(step.arg);
        var lo = Math.min(ci, oi), hi = Math.max(ci, oi);
        var newName = H[lo] + '+' + H[hi];
        out = out.map(function (x) {
          var merged = String(x[lo] == null ? '' : x[lo]) + joiner + String(x[hi] == null ? '' : x[hi]);
          var nr = x.slice(0, lo).concat([merged]).concat(x.slice(lo + 1, hi)).concat(x.slice(hi + 1));
          while (nr.length < H.length - 1) nr.push('');
          return nr;
        });
        H = H.slice(0, lo).concat([newName]).concat(H.slice(lo + 1, hi)).concat(H.slice(hi + 1));
      }
    });

    /* 列数兜底：任何步骤都不该让行的长度与表头不一致 */
    out.forEach(function (x) {
      while (x.length < H.length) x.push('');
      if (x.length > H.length) x.length = H.length;
    });

    return {
      headers: H,
      rows: limit ? out.slice(0, limit) : out,
      total: out.length,
      logs: logs,
    };
  }

  /* ------------------------------------------------------------ 预览表格 -- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 只渲染前 limit 行，几万行也不会把页面拖死 */
  function tableHtml(headers, rows, limit) {
    limit = limit || 20;
    var h = '<div class="rtable"><table><thead><tr><th>#</th>';
    headers.forEach(function (x) { h += '<th>' + esc(x) + '</th>'; });
    h += '</tr></thead><tbody>';
    var show = Math.min(rows.length, limit);
    for (var i = 0; i < show; i++) {
      h += '<tr><td class="muted">' + (i + 1) + '</td>';
      for (var c = 0; c < headers.length; c++) {
        h += '<td class="mono">' + esc(rows[i][c]) + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    if (rows.length > show) {
      h += '<div class="muted" style="margin-top:6px">仅预览前 ' + show + ' 行，共 ' +
           rows.length.toLocaleString('zh-CN') + ' 行</div>';
    }
    return h;
  }

  TB.dataCore = {
    normHeader: normHeader,
    planMerge: planMerge,
    mergeTables: mergeTables,
    safeFileName: safeFileName,
    groupRowsBy: groupRowsBy,
    uniqueNames: uniqueNames,
    fuzzyNormalize: fuzzyNormalize,
    similarity: similarity,
    cmpKey: cmpKey,
    cmpEq: cmpEq,
    OPS: OPS,
    needsArg: needsArg,
    describeStep: describeStep,
    applyPipeline: applyPipeline,
    normDate: normDate,
    validYmd: validYmd,
    cleanNumber: cleanNumber,
    tableHtml: tableHtml,
  };
  /* 公式列 / 交叉表在 js/data-formula.js 里挂到同一个 TB.dataCore 上 */
})();

