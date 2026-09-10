/* ============ JWT / 文本统计 / 房贷利息 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

/* ---------- JWT ---------- */
function b64urlDecode(s){
  s = s.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  try{
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  }catch(e){
    // maybe not json
    try{
      var bin2 = atob(s);
      return JSON.parse(bin2);
    }catch(e2){
      throw new Error('解码失败：' + e.message);
    }
  }
}
function pretty(o){
  return JSON.stringify(o, null, 2);
}
$('jwtParse').onclick = function(){
  var t = $('jwtIn').value.trim();
  if (!t){ notice('warn','请粘贴 JWT'); return; }
  t = t.replace(/^Bearer\s+/i, '');
  var parts = t.split('.');
  if (parts.length < 2){ notice('err','格式不对，应为 header.payload.signature'); return; }
  try{
    var header = b64urlDecode(parts[0]);
    var payload = b64urlDecode(parts[1]);
    var sig = parts[2] || '';
    $('jwtHeader').textContent = pretty(header);
    $('jwtPayload').textContent = pretty(payload);
    $('jwtSig').textContent = sig ? (sig + '\n（长度 ' + sig.length + '，本工具只查看不验签）') : '（无签名段）';
    var warns = [];
    if (payload.exp){
      var exp = payload.exp * 1000;
      var now = Date.now();
      if (exp < now) warns.push('已过期 ' + fmtAgo(now - exp));
      else warns.push('还有 ' + fmtAgo(exp - now) + ' 过期');
    }
    if (payload.nbf && payload.nbf * 1000 > Date.now()) warns.push('尚未生效');
    $('jwtWarn').textContent = warns.join(' · ');
    notice('info','已解析');
  }catch(e){
    notice('err', esc(e.message));
    $('jwtHeader').textContent = '—';
    $('jwtPayload').textContent = '—';
    $('jwtSig').textContent = '—';
    $('jwtWarn').textContent = '';
  }
};
function fmtAgo(ms){
  var s = Math.floor(ms/1000);
  if (s < 60) return s + '秒';
  if (s < 3600) return Math.floor(s/60) + '分';
  if (s < 86400) return Math.floor(s/3600) + '小时';
  return Math.floor(s/86400) + '天';
}
$('jwtClear').onclick = function(){
  $('jwtIn').value = '';
  $('jwtHeader').textContent = '—';
  $('jwtPayload').textContent = '—';
  $('jwtSig').textContent = '—';
  $('jwtWarn').textContent = '';
};

/* ---------- 文本统计 ---------- */
function analyze(){
  var t = $('tsText').value;
  var lines = t ? t.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n') : [];
  var nonEmpty = lines.filter(function(l){ return l.trim() !== ''; });
  var cjk = (t.match(/[一-鿿㐀-䶿]/g) || []).length;
  var latin = (t.match(/[a-zA-Z]/g) || []).length;
  var digits = (t.match(/[0-9]/g) || []).length;
  var spaces = (t.match(/\s/g) || []).length;
  var punct = (t.match(/[，。！？；：、“”‘’（）【】《》…—,.!?;:"'()\[\]<>]/g) || []).length;
  var words = (t.match(/[一-鿿]|[a-zA-Z0-9_]+/g) || []).length;
  var paras = t.split(/\n\s*\n/).filter(function(p){ return p.trim(); }).length;
  var maxLine = lines.reduce(function(m,l){ return Math.max(m, l.length); }, 0);
  // 阅读时间：中文 ~400字/分，英文 ~200词/分 粗估
  var min = (cjk / 400) + ((words - cjk) / 200);
  $('tsOut').innerHTML =
    row('总字符', t.length) +
    row('行数', lines.length) +
    row('非空行', nonEmpty.length) +
    row('段落', paras) +
    row('词/词组', words) +
    row('中文字符', cjk) +
    row('英文字母', latin) +
    row('数字', digits) +
    row('空白', spaces) +
    row('标点', punct) +
    row('最长行', maxLine) +
    row('预计阅读', t.trim() ? (min < 1 ? Math.max(1, Math.round(min*60)) + ' 秒' : min.toFixed(1) + ' 分钟') : '—');
}
function row(k, v){
  return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line2)">' +
    '<span class="muted">'+k+'</span><b class="mono">'+v+'</b></div>';
}
$('tsAnalyze').onclick = analyze;
$('tsText').addEventListener('input', function(){
  clearTimeout(window.__tstat);
  window.__tstat = setTimeout(analyze, 200);
});
$('tsClear').onclick = function(){ $('tsText').value = ''; analyze(); };
analyze();

/* ---------- 房贷 / 利息 ---------- */
function money(n){
  if (!isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function calcMortgage(){
  var P = parseFloat($('mdPrice').value) || 0; // 万
  var ratio = parseFloat($('mdRatio').value) / 100;
  var years = parseInt($('mdYears').value, 10) || 30;
  var rate = parseFloat($('mdRate').value) / 100;
  var principal = P * 10000 * ratio;
  var n = years * 12;
  var i = rate / 12;
  var rows = [];
  if (principal <= 0 || n <= 0){
    $('mdResult').textContent = '请填写有效房价/年限';
    return;
  }
  var monthly, totalPay, totalInterest;
  if ($('mdMode').value === 'eq'){ // 等额本息
    if (i === 0){
      monthly = principal / n;
      totalPay = principal;
      totalInterest = 0;
    } else {
      var q = Math.pow(1+i, n);
      monthly = principal * i * q / (q - 1);
      totalPay = monthly * n;
      totalInterest = totalPay - principal;
    }
    rows.push(row('贷款本金', money(principal) + ' 元'));
    rows.push(row('月供（等额本息）', money(monthly) + ' 元'));
    rows.push(row('还款总额', money(totalPay) + ' 元'));
    rows.push(row('利息合计', money(totalInterest) + ' 元'));
  } else { // 等额本金
    var base = principal / n;
    totalInterest = 0;
    for (var k=1;k<=n;k++){
      var interest = (principal - base*(k-1)) * i;
      totalInterest += interest;
    }
    var first = base + principal * i;
    var last = base + base * i;
    totalPay = principal + totalInterest;
    rows.push(row('贷款本金', money(principal) + ' 元'));
    rows.push(row('首月月供', money(first) + ' 元'));
    rows.push(row('末月月供', money(last) + ' 元'));
    rows.push(row('月供递减', money(base * i) + ' 元'));
    rows.push(row('还款总额', money(totalPay) + ' 元'));
    rows.push(row('利息合计', money(totalInterest) + ' 元'));
  }
  rows.push(row('首付', money(P*10000 - principal) + ' 元'));
  $('mdResult').innerHTML = rows.join('');
}
['mdPrice','mdRatio','mdYears','mdRate','mdMode'].forEach(function(id){
  $(id).addEventListener('input', calcMortgage);
  $(id).addEventListener('change', calcMortgage);
});
$('mdCalc').onclick = calcMortgage;
calcMortgage();

/* ---------- 利息（单利/复利） ---------- */
function calcInterest(){
  var P = parseFloat($('itPrincipal').value) || 0;
  var r = parseFloat($('itRate').value) / 100;
  var years = parseFloat($('itYears').value) || 0;
  var times = parseInt($('itTimes').value, 10) || 1; // 每年复利次数
  if (P <= 0 || years <= 0){
    $('itResult').textContent = '请填写有效本金与年限';
    return;
  }
  var simple = P * (1 + r * years);
  var n = Math.max(1, Math.round(years * times));
  var compound = P * Math.pow(1 + r / times, n);
  $('itResult').innerHTML =
    row('本金', money(P) + ' 元') +
    row('单利终值', money(simple) + ' 元') +
    row('单利收益', money(simple - P) + ' 元') +
    row('复利终值', money(compound) + ' 元') +
    row('复利收益', money(compound - P) + ' 元');
}
['itPrincipal','itRate','itYears','itTimes'].forEach(function(id){
  $(id).addEventListener('input', calcInterest);
});
$('itCalc').onclick = calcInterest;
calcInterest();
})();
