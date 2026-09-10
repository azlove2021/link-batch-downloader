/* ============ 正则测试 + 文本 Diff ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

/* ---------- 正则 ---------- */
document.querySelectorAll('[data-re]').forEach(function(b){
  b.onclick = function(){ $('rePat').value = b.getAttribute('data-re'); runRe(); };
});
$('reTest').onclick = runRe;
$('rePat').addEventListener('keydown', function(e){ if(e.key==='Enter') runRe(); });

function runRe(){
  var pat = $('rePat').value;
  var flags = $('reFlags').value || 'g';
  if(!pat){ $('reOut').textContent = '请输入正则'; $('reOut').classList.add('empty'); return; }
  var re;
  try{ re = new RegExp(pat, flags); }
  catch(e){
    $('reStat').textContent = '正则错误：' + e.message;
    $('reOut').textContent = e.message;
    $('reOut').classList.remove('empty');
    return;
  }
  var text = $('reText').value;
  var hits = [];
  if(re.global){
    var m;
    while((m = re.exec(text)) !== null){
      hits.push(m);
      if(m[0] === '') re.lastIndex++;
      if(hits.length > 5000) break;
    }
  }else{
    var m = re.exec(text);
    if(m) hits.push(m);
  }
  $('reStat').textContent = '匹配 ' + hits.length + ' 处' + (hits[0] && hits[0].length > 1 ? ' · 含分组' : '');

  // 高亮显示
  var html = '', last = 0;
  hits.forEach(function(m){
    html += esc(text.slice(last, m.index));
    html += '<span class="re-hit">' + esc(m[0]) + '</span>';
    last = m.index + m[0].length;
  });
  html += esc(text.slice(last));
  $('reOut').innerHTML = html || '(无匹配)';
  $('reOut').classList.remove('empty');
}

$('reToText').onclick = function(){
  var pat = $('rePat').value, flags = ($('reFlags').value||'g');
  if(!pat) return;
  var re;
  try{ re = new RegExp(pat, flags.indexOf('g')>=0?flags:flags+'g'); }
  catch(e){ notice('err','正则错误'); return; }
  var text = $('reText').value, m, out=[];
  while((m = re.exec(text)) !== null){
    out.push(m[0]);
    if(m[0]==='') re.lastIndex++;
    if(out.length>5000) break;
  }
  if(TB.text) TB.text.setIn(out.join('\n'));
  notice('info','已送入文本处理（'+out.length+' 条）');
  // 导航到文本工具
  var nav = document.querySelector('[data-tool="text"]');
  if(nav) nav.click();
};

/* ---------- Diff（LCS 行级） ---------- */
$('diffRun').onclick = function(){
  var A = $('diffA').value.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  var B = $('diffB').value.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if($('diffA').value === ''){ $('diffOut').textContent = 'A 为空'; return; }
  var ops = lineDiff(A, B);
  var add=0, del=0;
  var html = '';
  ops.forEach(function(op){
    if(op.t === 'ctx') html += '<div class="diff-line ctx">' + esc(op.line) + '</div>';
    else if(op.t === 'add'){ add++; html += '<div class="diff-line add">+ ' + esc(op.line) + '</div>'; }
    else { del++; html += '<div class="diff-line del">- ' + esc(op.line) + '</div>'; }
  });
  $('diffOut').innerHTML = html;
  $('diffOut').classList.remove('empty');
  $('diffStat').textContent = '新增 ' + add + ' 行 · 删除 ' + del + ' 行 · 相同 ' + (ops.length - add - del) + ' 行';
};

function lineDiff(A, B){
  var n = A.length, m = B.length;
  // LCS DP — 行数过大时降级为朴素对比
  if(n * m > 4e6){
    var ops = [];
    var max = Math.max(n,m);
    for(var i=0;i<max;i++){
      if(i<n && i<m && A[i]===B[i]) ops.push({t:'ctx',line:A[i]});
      else{
        if(i<n) ops.push({t:'del',line:A[i]});
        if(i<m) ops.push({t:'add',line:B[i]});
      }
    }
    return ops;
  }
  var dp = [];
  for(var i=0;i<=n;i++){ dp.push(new Int32Array(m+1)); }
  for(var i=n-1;i>=0;i--){
    for(var j=m-1;j>=0;j--){
      if(A[i]===B[j]) dp[i][j] = dp[i+1][j+1] + 1;
      else dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  var ops = [];
  var i=0,j=0;
  while(i<n && j<m){
    if(A[i]===B[j]){ ops.push({t:'ctx',line:A[i]}); i++; j++; }
    else if(dp[i+1][j] >= dp[i][j+1]){ ops.push({t:'del',line:A[i]}); i++; }
    else { ops.push({t:'add',line:B[j]}); j++; }
  }
  while(i<n){ ops.push({t:'del',line:A[i]}); i++; }
  while(j<m){ ops.push({t:'add',line:B[j]}); j++; }
  return ops;
}

$('diffSwap').onclick = function(){
  var a = $('diffA').value;
  $('diffA').value = $('diffB').value;
  $('diffB').value = a;
};
$('diffClear').onclick = function(){
  $('diffA').value=''; $('diffB').value='';
  $('diffOut').textContent = '点击「对比」查看结果';
  $('diffOut').classList.add('empty');
  $('diffStat').textContent = '';
};
})();
