/* ============ 时间戳 / 随机密码 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

/* ---------- 时间戳 ---------- */
function tickNow(){
  var d = new Date();
  $('tsNowShow').textContent =
    d.toLocaleString('zh-CN') + '  ·  ' + Math.floor(d.getTime()/1000) + '  ·  ' + d.getTime() + 'ms';
}
tickNow();
setInterval(tickNow, 1000);

$('tsNow').onclick = tickNow;

$('tsConv').onclick = function(){
  var s = $('tsIn').value.trim();
  if(!s){ notice('warn','请输入时间戳'); return; }
  var n = Number(s);
  if(!isFinite(n)){ notice('err','不是数字'); return; }
  var ms = $('tsMs').checked || s.length >= 13;
  var d = new Date(ms ? n : n * 1000);
  if(isNaN(d.getTime())){ notice('err','时间戳无效'); return; }
  $('tsOut').textContent =
    '本地：' + d.toLocaleString('zh-CN') + '\n' +
    'ISO ：' + d.toISOString() + '\n' +
    'UTC ：' + d.toUTCString() + '\n' +
    '秒  ：' + Math.floor(d.getTime()/1000) + '\n' +
    '毫秒：' + d.getTime() + '\n' +
    '星期：' + '日一二三四五六'[d.getDay()];
};

$('dtConv').onclick = function(){
  var s = $('dtIn').value.trim();
  if(!s){ notice('warn','请输入时间'); return; }
  // 宽松解析
  var t = Date.parse(s.replace(/年|月/g,'-').replace(/日/g,''));
  if(isNaN(t)){
    t = Date.parse(s);
  }
  if(isNaN(t)){ notice('err','无法解析时间格式'); return; }
  var d = new Date(t);
  $('dtOut').textContent =
    '秒  ：' + Math.floor(d.getTime()/1000) + '\n' +
    '毫秒：' + d.getTime() + '\n' +
    '本地：' + d.toLocaleString('zh-CN') + '\n' +
    'ISO ：' + d.toISOString();
};
$('dtUseNow').onclick = function(){
  var d = new Date();
  var p = function(n){ return (n<10?'0':'')+n; };
  $('dtIn').value = d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
};

/* ---------- 随机 ---------- */
function randInt(max){
  var a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}
function randStr(pool, n){
  var s = '';
  for(var i=0;i<n;i++) s += pool[randInt(pool.length)];
  return s;
}

$('pwGen').onclick = function(){
  var len = Math.min(128, Math.max(4, parseInt($('pwLen').value,10)||16));
  var count = Math.min(50, Math.max(1, parseInt($('pwCount').value,10)||5));
  var pools = [];
  if($('pwLower').checked) pools.push('abcdefghijkmnopqrstuvwxyz');
  if($('pwUpper').checked) pools.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if($('pwDigit').checked) pools.push('23456789');
  if($('pwSymbol').checked) pools.push('!@#$%^&*-_=+?');
  if(!pools.length){ notice('err','至少选一种字符'); return; }
  var all = pools.join('');
  // 确保每种至少一个
  var list = [];
  for(var i=0;i<count;i++){
    var chars = pools.map(function(p){ return p[randInt(p.length)]; });
    var rest = len - chars.length;
    if(rest > 0) chars = chars.concat(randStr(all, rest).split(''));
    // shuffle
    for(var j=chars.length-1;j>0;j--){
      var k = randInt(j+1);
      var t=chars[j]; chars[j]=chars[k]; chars[k]=t;
    }
    list.push(chars.join(''));
  }
  $('pwOut').textContent = list.join('\n');
};

$('uuGen').onclick = function(){
  var out = [];
  for(var i=0;i<10;i++){
    if(crypto.randomUUID) out.push(crypto.randomUUID());
    else{
      var b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80;
      var h = Array.from(b).map(function(x){ return ('0'+x.toString(16)).slice(-2); }).join('');
      out.push(h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20));
    }
  }
  $('uuOut').textContent = out.join('\n');
};
$('uuNano').onclick = function(){
  var out = [];
  for(var i=0;i<10;i++){
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    out.push(Array.from(b).map(function(x){ return ('0'+x.toString(16)).slice(-2); }).join(''));
  }
  $('uuOut').textContent = out.join('\n');
};
$('uuBase64').onclick = function(){
  var pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = [];
  for(var i=0;i<10;i++) out.push(randStr(pool, 22));
  $('uuOut').textContent = out.join('\n');
};
$('uuCode').onclick = function(){
  var out = [];
  for(var i=0;i<6;i++) out.push(String(randInt(1000000)).padStart(6,'0'));
  $('uuOut').textContent = out.join('\n');
};
$('uuCopy').onclick = function(){ U.copyText($('uuOut').value); };
})();
