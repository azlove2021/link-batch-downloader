/* ============ 批量下载 · 纯函数核心（自定义请求头 / 失败清单） ============
 * 抽成独立文件的原因：浏览器对哪些请求头是「禁止修改」的规则很容易搞错，
 * 失败清单又必须能被 parseTxt 原样再导入（格式差一点就回炉不了），
 * 这两处都值得单元测试盯住（tests/download-core.test.cjs）。
 * UI 层（js/download.js）只负责接线。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* 浏览器 fetch/XHR 的禁止请求头（设置了也会被静默丢弃）。
   * 除了精确匹配，sec- / proxy- 前缀的头也一律禁止。 */
  var FORBIDDEN = {
    'accept-charset': 1, 'access-control-request-headers': 1, 'access-control-request-method': 1,
    'connection': 1, 'content-length': 1, 'cookie': 1, 'cookie2': 1, 'date': 1, 'dnt': 1,
    'expect': 1, 'host': 1, 'keep-alive': 1, 'origin': 1, 'proxy-authorization': 1,
    'referer': 1, 'referrer': 1, 'te': 1, 'trailer': 1, 'transfer-encoding': 1,
    'upgrade': 1, 'user-agent': 1, 'via': 1
  };

  /* 解析「头名: 值」逐行文本。返回 { headers, forbidden, cookieWanted }：
   *   headers      —— 浏览器允许、会真正生效的头（重名后者覆盖）
   *   forbidden    —— [{name, value}] 被拦截的禁止头（UI 应提示用户）
   *   cookieWanted —— 用户写了 Cookie:，想带 cookie（UI 应改用 credentials 模式） */
  function parseHeaders(text) {
    var headers = {}, forbidden = [], cookieWanted = false;
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line.charAt(0) === '#' || line.slice(0, 2) === '//') return;
      var i = line.indexOf(':');
      if (i <= 0) return;
      var name = line.slice(0, i).trim();
      var value = line.slice(i + 1).trim();
      if (!name || !value) return;
      var lower = name.toLowerCase();
      if (lower === 'cookie' || lower === 'cookie2') {
        cookieWanted = true;
        forbidden.push({ name: name, value: value });
        return;
      }
      if (FORBIDDEN[lower] || lower.slice(0, 4) === 'sec-' || lower.slice(0, 6) === 'proxy-') {
        forbidden.push({ name: name, value: value });
        return;
      }
      headers[name] = value;
    });
    return { headers: headers, forbidden: forbidden, cookieWanted: cookieWanted };
  }

  /* 失败任务 → txt：标题<TAB>链接，一行一条。
   * 故意不带失败原因/注释列 —— 导出的文件要能被 parseTxt 直接再扫回来重下。 */
  function failListTxt(tasks) {
    var lines = [];
    (tasks || []).forEach(function (t) {
      if (!t || !t.url) return;
      var title = String(t.title == null ? '' : t.title).replace(/[\r\n\t]+/g, ' ').trim();
      lines.push((title ? title + '\t' : '') + t.url);
    });
    return lines.join('\r\n') + (lines.length ? '\r\n' : '');
  }

  TB.downloadCore = {
    parseHeaders: parseHeaders,
    failListTxt: failListTxt,
  };
})();
