/* ============ 表格互转 CSV/TSV/JSON/MD/XLSX ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

function msg(s){ $('cvMsg').textContent = s || ''; }

function rowsFromInput(){
  var type = $('cvInType').value;
  var text = $('cvIn').value;
  if(!text.trim()){ notice('warn','请先粘贴数据'); return null; }
  var hasHeader = $('cvHasHeader').checked;
  if(type === 'csv' || type === 'tsv'){
    var rows = U.parseCsv(text, type === 'tsv' ? '\t' : ',');
    return finalize(rows, hasHeader);
  }
  if(type === 'json'){
    var v;
    try{ v = JSON.parse(text); }
    catch(e){ notice('err','JSON 解析失败：'+esc(e.message)); return null; }
    if(!Array.isArray(v)){ notice('err','需要 JSON 数组'); return null; }
    if(v.length && Array.isArray(v[0])) return { headers: hasHeader ? v[0] : v[0].map(function(_,i){return 'c'+(i+1);}), rows: hasHeader ? v.slice(1) : v };
    if(v.length && typeof v[0] === 'object'){
      var headers = [];
      v.forEach(function(o){ Object.keys(o||{}).forEach(function(k){ if(headers.indexOf(k)<0) headers.push(k); }); });
      return { headers: headers, rows: v.map(function(o){ return headers.map(function(h){ return o && o[h]!=null ? o[h] : ''; }); }) };
    }
    notice('err','不支持的 JSON 结构'); return null;
  }
  if(type === 'md'){
    var lines = text.replace(/\r/g,'').split('\n').filter(function(l){ return l.trim() && !/^\s*\|?\s*:?-{3,}/.test(l.trim()); });
    var rows = lines.map(function(l){
      var s = l.trim();
      if(s.startsWith('|')) s = s.slice(1);
      if(s.endsWith('|')) s = s.slice(0,-1);
      return s.split('|').map(function(c){ return c.trim(); });
    });
    return finalize(rows, hasHeader);
  }
  return null;
}
function finalize(rows, hasHeader){
  if(!rows.length) return null;
  if(hasHeader) return { headers: rows[0], rows: rows.slice(1) };
  var cols = Math.max.apply(null, rows.map(function(r){ return r.length; }));
  var headers = [];
  for(var i=0;i<cols;i++) headers.push('c'+(i+1));
  return { headers: headers, rows: rows };
}
function showOut(text){
  $('cvOut').textContent = text;
  $('cvOut').classList.remove('empty');
}

$('cvToJson').onclick = function(){
  var d = rowsFromInput(); if(!d) return;
  var arr = d.rows.map(function(r){
    var o = {};
    d.headers.forEach(function(h,i){ o[h] = r[i] != null ? r[i] : ''; });
    return o;
  });
  showOut(JSON.stringify(arr, null, 2));
  msg('JSON · ' + arr.length + ' 行');
};
$('cvToCsv').onclick = function(){
  var d = rowsFromInput(); if(!d) return;
  showOut(U.toCsv([d.headers].concat(d.rows), ','));
  msg('CSV · ' + d.rows.length + ' 行');
};
$('cvToTsv').onclick = function(){
  var d = rowsFromInput(); if(!d) return;
  showOut(U.toCsv([d.headers].concat(d.rows), '\t'));
  msg('TSV · ' + d.rows.length + ' 行');
};
$('cvToMd').onclick = function(){
  var d = rowsFromInput(); if(!d) return;
  function row(r){ return '| ' + r.map(function(c){ return String(c==null?'':c).replace(/\|/g,'\\|'); }).join(' | ') + ' |'; }
  var md = [row(d.headers), '| ' + d.headers.map(function(){ return '---'; }).join(' | ') + ' |'];
  d.rows.forEach(function(r){ md.push(row(r)); });
  showOut(md.join('\n'));
  msg('Markdown · ' + d.rows.length + ' 行');
};
$('cvToXlsx').onclick = async function(){
  var d = rowsFromInput(); if(!d) return;
  try{
    var blob = await U.makeXlsx(d.headers, d.rows, '数据');
    U.saveBlob(blob, '表格导出.xlsx');
    msg('已下载 xlsx');
  }catch(e){ notice('err','导出失败：'+esc(e.message)); }
};
$('cvCopy').onclick = function(){
  var t = $('cvOut').textContent;
  if(!t || t === '转换结果'){ notice('warn','还没有结果'); return; }
  U.copyText(t);
};
})();
