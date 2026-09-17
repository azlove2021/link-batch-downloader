/* ============ 文本处理 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;
var TC = TB.textCore || {};   /* 纯函数核心：js/text-core.js（脱敏 / 粘贴清洗） */

function lines(){
  return $('textIn').value.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
}
function setOut(v){
  $('textOut').value = v;
  updateStat();
}
function joinOut(arr){
  return arr.join('\n');
}
function updateStat(){
  var i = $('textIn').value;
  var o = $('textOut').value;
  $('textStat').textContent = (i ? i.replace(/\r\n/g,'\n').split('\n').length : 0) + ' 行 · ' + i.length + ' 字';
  $('textOutStat').textContent = o ? ((o ? o.replace(/\r\n/g,'\n').split('\n').length : 0) + ' 行 · ' + o.length + ' 字') : '';
}
$('textIn').addEventListener('input', updateStat);
updateStat();

function sepVal(){
  var v = $('txSep').value;
  if(v === 'custom') return $('txSepCustom').value || ',';
  return v;
}
$('txSep').addEventListener('change', function(){
  $('txSepCustom').style.display = this.value === 'custom' ? '' : 'none';
});

$('txJoin').onclick = function(){
  var arr = lines().filter(function(l){ return l.trim() !== ''; });
  setOut(arr.map(function(l){ return l.trim(); }).join(sepVal()));
};

$('txDedupe').onclick = function(){
  var seen = Object.create(null), out = [];
  lines().forEach(function(l){
    var k = l.trim();
    if(!k || seen[k]) return;
    seen[k] = 1; out.push(l);
  });
  setOut(joinOut(out));
  notice('info','已去重：保留 ' + out.length + ' 行');
};

$('txSortA').onclick = function(){
  var arr = lines().slice().sort(function(a,b){ return a.localeCompare(b,'zh'); });
  setOut(joinOut(arr));
};
$('txSortD').onclick = function(){
  var arr = lines().slice().sort(function(a,b){ return b.localeCompare(a,'zh'); });
  setOut(joinOut(arr));
};
$('txTrim').onclick = function(){
  setOut(joinOut(lines().map(function(l){ return l.replace(/^\s+|\s+$/g,''); })));
};
$('txBlank').onclick = function(){
  setOut(joinOut(lines().filter(function(l){ return l.trim() !== ''; })));
};
$('txNumber').onclick = function(){
  var n = lines().filter(function(l){ return l.trim() !== ''; });
  setOut(n.map(function(l,i){ return (i+1) + '. ' + l.trim(); }).join('\n'));
};
$('txReverse').onclick = function(){
  setOut(joinOut(lines().reverse()));
};

var EXTRACT = {
  url: /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/g,
  email: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  phone: /(?<![0-9])1[3-9]\d{9}(?![0-9])/g,
  idcard: /(?<![0-9Xx])[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![0-9Xx])/g,
  num: /-?\d+(?:\.\d+)?/g,
  cn: /[一-龥]+/g
};
document.querySelectorAll('[data-extract]').forEach(function(btn){
  btn.onclick = function(){
    var key = btn.getAttribute('data-extract');
    var re = EXTRACT[key];
    var text = $('textOut').value || $('textIn').value;
    var m = text.match(re) || [];
    setOut(m.join('\n'));
    notice('info','提取到 ' + m.length + ' 项');
  };
});

/* 脱敏：手机号 / 身份证 / 邮箱打码。
 * 正则和边界保护都在 js/text-core.js（有单元测试），这里只接线。 */
var MASK_FN = { phone:'maskPhone', idcard:'maskIdCard', email:'maskEmail', all:'maskAll' };
document.querySelectorAll('[data-mask]').forEach(function(btn){
  btn.onclick = function(){
    var fn = TC[MASK_FN[btn.getAttribute('data-mask')]];
    var src = $('textOut').value || $('textIn').value;
    if(!src){ notice('warn','没有内容'); return; }
    if(!fn){ notice('err','脱敏模块未加载（js/text-core.js）'); return; }
    var out = fn(src);
    setOut(out);
    notice(out === src ? 'warn' : 'info', out === src ? '没有找到需要脱敏的内容' : '已脱敏');
  };
});

/* 粘贴清洗：网页 / PDF 复制来的文本一键整理 */
var CLEAN_FN = { zw:'stripZeroWidth', half:'fullWidthToHalf', punct:'normalizePunct', join:'joinWrappedLines', all:'cleanPaste' };
document.querySelectorAll('[data-clean]').forEach(function(btn){
  btn.onclick = function(){
    var fn = TC[CLEAN_FN[btn.getAttribute('data-clean')]];
    var src = $('textOut').value || $('textIn').value;
    if(!src){ notice('warn','没有内容'); return; }
    if(!fn){ notice('err','清洗模块未加载（js/text-core.js）'); return; }
    setOut(fn(src));
    notice('info','已清洗');
  };
});

$('txToUpper').onclick = function(){ setOut(($('textOut').value || $('textIn').value).toUpperCase()); };
$('txToLower').onclick = function(){ setOut(($('textOut').value || $('textIn').value).toLowerCase()); };

$('txReplace').onclick = function(){
  var from = prompt('查找什么？');
  if(from == null || from === '') return;
  var to = prompt('替换为（留空=删除）', '');
  if(to == null) return;
  var useRe = confirm('用正则替换吗？\n确定=正则，取消=普通文本');
  var src = $('textOut').value || $('textIn').value;
  var out;
  try{
    if(useRe) out = src.replace(new RegExp(from,'g'), to);
    else out = src.split(from).join(to);
  }catch(e){ notice('err','正则错误：'+esc(e.message)); return; }
  setOut(out);
};

$('txPrefix').onclick = function(){
  var p = prompt('加什么前缀？');
  if(p == null || p === '') return;
  setOut(lines().map(function(l){ return l.trim() ? p + l : l; }).join('\n'));
};
$('txSuffix').onclick = function(){
  var p = prompt('加什么后缀？');
  if(p == null || p === '') return;
  setOut(lines().map(function(l){ return l.trim() ? l + p : l; }).join('\n'));
};

$('txCopy').onclick = function(){ U.copyText($('textOut').value); };
$('txClear').onclick = function(){ $('textIn').value=''; $('textOut').value=''; updateStat(); };
$('txSwap').onclick = function(){
  var a = $('textIn').value;
  $('textIn').value = $('textOut').value;
  $('textOut').value = a;
  updateStat();
};
$('txDownload').onclick = function(){
  var v = $('textOut').value || $('textIn').value;
  if(!v){ notice('warn','没有内容'); return; }
  U.saveBlob(new Blob([v],{type:'text/plain;charset=utf-8'}), '文本处理结果.txt');
};

// 供正则工具调用
TB.text = { setIn: function(v){ $('textIn').value = v; updateStat(); } };
})();
