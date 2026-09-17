/* ============ 正则测试 + 文本 Diff ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

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
