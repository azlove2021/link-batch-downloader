/* ============ 文本处理 · 纯函数核心（脱敏 / 粘贴清洗） ============
 * 抽成独立文件的原因：脱敏正则和清洗规则最容易在边界上出错
 * （比如把订单号里的 11 位数字当手机号、把中文标点误转半角），
 * 放在这里可以不带浏览器直接跑单元测试（tests/text-core.test.cjs）。
 * UI 层（js/text.js）只负责把按钮接到这些函数上。
 */
'use strict';
(function () {
  var TB = window.TB || (window.TB = {});

  /* ---------- 识别正则（带边界保护，避免误伤长数字串） ---------- */
  var RE_PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
  var RE_IDCARD = /(?<![\dXx])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dXx])/g;
  var RE_EMAIL = /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

  /* 通用打码：保留前 head 位、后 tail 位，中间用 * 填满（总长度不变） */
  function keepEdges(s, head, tail) {
    s = String(s == null ? '' : s);
    if (s.length <= head + tail) return s.replace(/[\s\S]/g, '*');
    return s.slice(0, head) + '*'.repeat(s.length - head - tail) + s.slice(s.length - tail);
  }

  /* 手机号：138****5678（前 3 后 4） */
  function maskPhone(text) {
    return String(text == null ? '' : text).replace(RE_PHONE, function (m) {
      return m.slice(0, 3) + '****' + m.slice(7);
    });
  }

  /* 身份证（18 位）：前 4 后 4，出生日期整段打码 */
  function maskIdCard(text) {
    return String(text == null ? '' : text).replace(RE_IDCARD, function (m) {
      return keepEdges(m, 4, 4);
    });
  }

  /* 邮箱：用户名保留前 2 位（太短则保留 1 位），域名完整保留 */
  function maskEmail(text) {
    return String(text == null ? '' : text).replace(RE_EMAIL, function (m) {
      var at = m.indexOf('@');
      var local = m.slice(0, at), domain = m.slice(at);
      var keep = local.length > 3 ? 2 : 1;
      return local.slice(0, keep) + '***' + domain;
    });
  }

  /* 一键全部脱敏。顺序：邮箱 → 身份证 → 手机号。
   * 先处理邮箱，避免用户名里的 11 位数字被手机号规则先打散；
   * 再处理身份证，避免 18 位号码内部被手机号规则误伤。 */
  function maskAll(text) {
    return maskPhone(maskIdCard(maskEmail(text)));
  }

  /* ---------- 粘贴清洗 ---------- */

  /* 零宽字符 / BOM / 软连字符（网页复制最常见的隐形垃圾） */
  function stripZeroWidth(text) {
    return String(text == null ? '' : text).replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '');
  }

  /* 全角字母数字 → 半角，全角空格 → 半角空格。
   * 故意不动全角标点（，。！？），中文正文里它们是正确写法。 */
  function fullWidthToHalf(text) {
    return String(text == null ? '' : text)
      .replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
      })
      .replace(/\u3000/g, ' ');
  }

  /* 中英标点统一 → 半角（清洗从网页 / PDF 复制的数据时用；正文慎用） */
  function normalizePunct(text) {
    var MAP = {
      '，': ',', '。': '.', '；': ';', '：': ':', '？': '?', '！': '!',
      '（': '(', '）': ')', '【': '[', '】': ']', '「': '[', '」': ']',
      '“': '"', '”': '"', '‘': "'", '’': "'", '、': ',',
      '《': '<', '》': '>', '—': '-', '～': '~', '　': ' '
    };
    return String(text == null ? '' : text)
      .replace(/[，。；：？！（）【】「」“”‘’、《》—～　]/g, function (ch) { return MAP[ch] || ch; })
      .replace(/\u2026/g, '...')   // … → ...
      .replace(/\.{3,}/g, '...');  // …… 展开后的连续点再压回一组
  }

  /* 合并断行：PDF / 网页复制最常见 —— 一段话被硬回车切成好几行。
   * 规则保守，只拼两种明确的断行：
   *   ① 上一行以连字符结尾且下一行以字母开头 → 去连字符直接拼（英文断词）
   *   ② 上一行以中文（或中文标点）结尾且下一行以中文开头 → 直接拼
   * 其余情况（数字行、列表、英文完整句）不动，避免帮倒忙。 */
  function joinWrappedLines(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var cur = lines[i];
      if (out.length) {
        var prev = out[out.length - 1];
        var prevT = prev.replace(/\s+$/, '');
        var nextT = cur.replace(/^\s+/, '');
        if (/-$/.test(prevT) && /^[A-Za-z]/.test(nextT)) {
          out[out.length - 1] = prevT.slice(0, -1) + nextT;
          continue;
        }
        if (/[\u4E00-\u9FFF，。、；：？！“”‘’]$/.test(prevT) && /^[\u4E00-\u9FFF“‘（]/.test(nextT)) {
          out[out.length - 1] = prevT + nextT;
          continue;
        }
      }
      out.push(cur);
    }
    return out.join('\n');
  }

  /* 一键清洗：去零宽 → 全角转半角(仅字母数字) → 合并断行 → 行首尾去空白 → 连续空格压成一个 */
  function cleanPaste(text) {
    var s = stripZeroWidth(text);
    s = fullWidthToHalf(s);
    s = joinWrappedLines(s);
    s = s.replace(/\r\n?/g, '\n').split('\n')
         .map(function (l) { return l.replace(/^[ \t\u00A0]+|[ \t\u00A0]+$/g, ''); })
         .join('\n');
    return s.replace(/[ \t]{2,}/g, ' ');
  }

  TB.textCore = {
    keepEdges: keepEdges,
    maskPhone: maskPhone,
    maskIdCard: maskIdCard,
    maskEmail: maskEmail,
    maskAll: maskAll,
    stripZeroWidth: stripZeroWidth,
    fullWidthToHalf: fullWidthToHalf,
    normalizePunct: normalizePunct,
    joinWrappedLines: joinWrappedLines,
    cleanPaste: cleanPaste,
  };
})();
