/* ============ 批量重命名 · 纯函数核心 ============
 * 抽成独立文件的原因：日期识别是最容易出错、也最需要回归测试的逻辑，
 * 放在这里可以不带浏览器直接跑单元测试（tests/rename-core.test.cjs）。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* 文件名里不该出现的字符（Windows 规则）→ 下划线 */
  function sanitize(s) {
    return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '_').trim();
  }

  /* 去掉末尾扩展名（1-8 个非点字符）。传全名或纯主干都安全。 */
  function stripExt(s) {
    return String(s == null ? '' : s).replace(/\.[^.]{1,8}$/, '');
  }

  /* 把「去掉了日期」剩下的部分收拾干净：
   * IMG_20240103_001 → 去掉日期后是 IMG__001 → 收敛成 IMG_001 */
  function cleanRest(s) {
    return String(s == null ? '' : s)
      .replace(/^[\s._\-()（）[\]]+/, '')
      .replace(/[\s._\-()（）[\]]+$/, '')
      .replace(/[\s._\-]{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function validYmd(y, m, d) {
    if (!(y >= 1990 && y <= 2100)) return false;
    if (!(m >= 1 && m <= 12)) return false;
    if (!(d >= 1 && d <= 31)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /* 常见日期写法，按优先级排列。
   * digitsOnly 表示匹配到的整段比日期长（带了时分秒），只截前 8 位当日期。 */
  var PATTERNS = [
    { re: /(\d{4})[.\-_](\d{1,2})[.\-_](\d{1,2})/ },
    { re: /(\d{4})\s?年\s?(\d{1,2})\s?月\s?(\d{1,2})\s?日?/ },
    { re: /(?:^|[^\d])(\d{4})(\d{2})(\d{2})\d{6}(?!\d)/, digitsOnly: true }, // 20241231235959
    { re: /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?!\d)/, digitsOnly: true },     // 20240103
  ];

  /**
   * 从文件名里提取日期（自动忽略扩展名，传全名或主干都可以）。
   * @returns {{y:number,m:number,d:number,raw:string,rest:string,index:number}|null}
   *          rest = 去掉日期后收拾干净的剩余名称
   */
  function extractDate(input) {
    var stem = stripExt(String(input == null ? '' : input));
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      var m = stem.match(p.re);
      if (!m) continue;
      var y = parseInt(m[1], 10);
      var mo = parseInt(m[2], 10);
      var d = parseInt(m[3], 10);
      if (!validYmd(y, mo, d)) continue;

      /* 带边界的模式会把前面那个非数字字符也匹配进来，计算位置时要排除 */
      var lead = /^\D/.test(m[0]) ? 1 : 0;
      var at = m.index + lead;
      var raw = m[0].slice(lead);
      if (p.digitsOnly) raw = raw.slice(0, 8);

      return {
        y: y, m: mo, d: d,
        raw: raw,
        index: at,
        rest: cleanRest(stem.slice(0, at) + ' ' + stem.slice(at + raw.length)),
      };
    }
    return null;
  }

  /** 按指定风格格式化 */
  function formatDate(found, style) {
    if (!found) return '';
    var y = String(found.y);
    var mo = ('0' + found.m).slice(-2);
    var d = ('0' + found.d).slice(-2);
    switch (style) {
      case '_': return y + '_' + mo + '_' + d;
      case '.': return y + '.' + mo + '.' + d;
      case 'cn': return y + '年' + mo + '月' + d + '日';
      case 'compact': return y + mo + d;
      case '-':
      default: return y + '-' + mo + '-' + d;
    }
  }

  /**
   * 套模板：支持 {date} 与 {name}
   * {name} 用「去掉日期」的剩余名称，避免日期重复出现。
   */
  function applyTemplate(tpl, dateStr, rest, fallbackName) {
    var name = cleanRest(rest);
    if (!name) name = String(fallbackName == null ? '' : fallbackName);
    var out = String(tpl == null ? '' : tpl)
      .split('{date}').join(dateStr)
      .split('{name}').join(name);
    return cleanRest(out);
  }

  TB.renameCore = {
    sanitize: sanitize,
    stripExt: stripExt,
    cleanRest: cleanRest,
    extractDate: extractDate,
    formatDate: formatDate,
    applyTemplate: applyTemplate,
    validYmd: validYmd,
  };
})();

