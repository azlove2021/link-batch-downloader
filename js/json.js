/* ============ JSON 工具 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

function parseJson(s){
  try{ return { ok:true, v: JSON.parse(s) }; }
  catch(e){ return { ok:false, e:e }; }
}
function showMsg(m, err){
  $('jsonMsg').textContent = m || '';
  $('jsonMsg').style.color = err ? 'var(--err)' : 'var(--tx3)';
}

$('jsonFormat').onclick = function(){
  var r = parseJson($('jsonIn').value.trim());
  if(!r.ok){ showMsg('格式错误：' + r.e.message, true); return; }
  $('jsonOut').value = JSON.stringify(r.v, null, 2);
  showMsg('已格式化');
};
$('jsonMinify').onclick = function(){
  var r = parseJson($('jsonIn').value.trim());
  if(!r.ok){ showMsg('格式错误：' + r.e.message, true); return; }
  $('jsonOut').value = JSON.stringify(r.v);
  showMsg('已压缩');
};
function sortKeys(v){
  if(Array.isArray(v)) return v.map(sortKeys);
  if(v && typeof v === 'object'){
    var o = {};
    Object.keys(v).sort().forEach(function(k){ o[k] = sortKeys(v[k]); });
    return o;
  }
  return v;
}
$('jsonSort').onclick = function(){
  var r = parseJson($('jsonIn').value.trim());
  if(!r.ok){ showMsg('格式错误：' + r.e.message, true); return; }
  $('jsonOut').value = JSON.stringify(sortKeys(r.v), null, 2);
  showMsg('键已排序');
};
$('jsonEscape').onclick = function(){
  $('jsonOut').value = JSON.stringify($('jsonIn').value);
  showMsg('已转义');
};
$('jsonUnescape').onclick = function(){
  var r = parseJson($('jsonIn').value.trim());
  if(r.ok && typeof r.v === 'string'){ $('jsonOut').value = r.v; showMsg('已反转义'); return; }
  // 尝试当作被转义的字符串字面量
  try{
    $('jsonOut').value = JSON.parse($('jsonIn').value.trim());
    showMsg('已反转义');
  }catch(e){ showMsg('无法反转义：需要带引号的 JSON 字符串', true); }
};

$('jsonCopyOut').onclick = function(){ U.copyText($('jsonOut').value); };
$('jsonSwap').onclick = function(){
  var a = $('jsonIn').value;
  $('jsonIn').value = $('jsonOut').value;
  $('jsonOut').value = a;
};

function getSep(){
  var v = $('jsonCsvSep').value;
  if(v === '\\t') return '\t';
  return v;
}
$('json2csv').onclick = function(){
  var r = parseJson($('jsonIn').value.trim());
  if(!r.ok){ showMsg('格式错误：' + r.e.message, true); return; }
  var arr = r.v;
  if(!Array.isArray(arr)){ showMsg('需要 JSON 数组（对象数组或二维数组）', true); return; }
  if(arr.length && !Array.isArray(arr[0]) && typeof arr[0] === 'object'){
    var headers = [];
    arr.forEach(function(o){ Object.keys(o).forEach(function(k){ if(headers.indexOf(k)<0) headers.push(k); }); });
    var rows = [headers];
    arr.forEach(function(o){ rows.push(headers.map(function(h){ return o[h]==null?'':o[h]; })); });
    $('jsonOut').value = U.toCsv(rows, getSep());
  } else if(Array.isArray(arr[0])){
    $('jsonOut').value = U.toCsv(arr, getSep());
  } else { showMsg('不支持的结构', true); return; }
  showMsg('已转 CSV');
};
$('csv2json').onclick = function(){
  var rows = U.parseCsv($('jsonIn').value, getSep());
  if(!rows.length){ showMsg('空数据', true); return; }
  var hasH = true;
  var headers = rows[0];
  var start = 1;
  var arr = [];
  for(var i=start;i<rows.length;i++){
    var o = {};
    for(var j=0;j<headers.length;j++) o[headers[j] || ('c'+j)] = rows[i][j] || '';
    arr.push(o);
  }
  $('jsonOut').value = JSON.stringify(arr, null, 2);
  showMsg('已转 JSON（' + arr.length + ' 行）');
};
})();
