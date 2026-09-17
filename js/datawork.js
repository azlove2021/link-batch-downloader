/* ============ 数据工作台：大表虚拟滚动 + 清洗 + 双表比对 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

var ROW_H = 28;
var OVERSCAN = 12;

var DS = {
  name: '',
  headers: [],
  rows: [],          // array of arrays (strings/numbers)
  view: [],          // indices into rows after filter
  filters: {},       // colIndex -> string contains
  search: '',
  sortCol: -1,
  sortDir: 0,        // 0 none 1 asc -1 desc
  selectedRow: -1,
  compare: null      // {name, headers, rows, keyCol, mainKey}
};

/* ---------- 快速 CSV 解析 ---------- */
function parseCsvFast(text, delim){
  delim = delim || ',';
  var rows = [], row = [], cur = '', inQ = false;
  var n = text.length;
  for (var i = 0; i < n; i++){
    var ch = text[i];
    if (inQ){
      if (ch === '"'){
        if (text[i+1] === '"'){ cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim){ row.push(cur); cur = ''; }
      else if (ch === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r'){ /* skip */ }
      else cur += ch;
    }
  }
  if (cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
function detectDelim(text){
  var line = text.slice(0, 2000).split(/\r?\n/)[0] || '';
  var c = (line.match(/,/g)||[]).length, t = (line.match(/\t/g)||[]).length, s = (line.match(/;/g)||[]).length;
  if (t > c && t > s) return '\t';
  if (s > c && s > t) return ';';
  return ',';
}

function fmtNum(n){
  if (n == null || n === '') return '';
  return n;
}

/* ---------- 虚拟滚动 ---------- */
var scroller, spacer, canvasEl, headEl;
function ensureDom(){
  scroller = $('dwScroll');
  spacer = $('dwSpacer');
  canvasEl = $('dwCanvas');
  headEl = $('dwHead');
}
function viewRowCount(){ return DS.view.length; }

function renderHead(){
  if (!headEl) return;
  var h = '<div class="dw-hrow">';
  h += '<div class="dw-cell dw-idx">#</div>';
  DS.headers.forEach(function(name, ci){
    var sortable = DS.sortCol === ci ? (DS.sortDir === 1 ? ' ↑' : ' ↓') : '';
    h += '<div class="dw-cell" data-sort="' + ci + '" title="点击排序">' + esc(name) + sortable + '</div>';
  });
  h += '</div>';
  // filter row
  h += '<div class="dw-hrow dw-frow">';
  h += '<div class="dw-cell dw-idx">筛</div>';
  DS.headers.forEach(function(_, ci){
    h += '<div class="dw-cell"><input type="text" data-f="' + ci + '" value="' + esc(DS.filters[ci] || '') + '" placeholder="包含…（!排除）"></div>';
  });
  h += '</div>';
  headEl.innerHTML = h;
  headEl.querySelectorAll('[data-sort]').forEach(function(el){
    el.onclick = function(){
      var ci = +el.getAttribute('data-sort');
      if (DS.sortCol === ci) DS.sortDir = -DS.sortDir;
      else { DS.sortCol = ci; DS.sortDir = 1; }
      rebuildView(true);
      renderHead();
      renderVisible();
    };
  });
  headEl.querySelectorAll('[data-f]').forEach(function(el){
    el.oninput = function(){
      var ci = +el.getAttribute('data-f');
      DS.filters[ci] = el.value;
      clearTimeout(window.__dwFt);
      window.__dwFt = setTimeout(function(){ rebuildView(true); renderVisible(); }, 180);
    };
  });
}

function renderVisible(){
  if (!scroller || !canvasEl || !spacer) return;
  var total = viewRowCount();
  spacer.style.height = (total * ROW_H) + 'px';
  var top = scroller.scrollTop;
  var h = scroller.clientHeight || 480;
  var start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  var end = Math.min(total, Math.ceil((top + h) / ROW_H) + OVERSCAN);
  canvasEl.style.transform = 'translateY(' + (start * ROW_H) + 'px)';
  var cols = DS.headers.length;
  var html = '';
  for (var i = start; i < end; i++){
    var ri = DS.view[i];
    var r = DS.rows[ri];
    html += '<div class="dw-row" data-i="' + i + '">';
    html += '<div class="dw-cell dw-idx">' + (i + 1) + '</div>';
    for (var c = 0; c < cols; c++){
      var v = r && r[c] != null ? r[c] : '';
      if (v.length > 120) v = v.slice(0, 120) + '…';
      html += '<div class="dw-cell">' + esc(v) + '</div>';
    }
    html += '</div>';
  }
  canvasEl.innerHTML = html;
  $('dwStat').textContent = '显示 ' + total.toLocaleString('zh-CN') + ' / ' + DS.rows.length.toLocaleString('zh-CN') + ' 行 · ' + cols + ' 列';
}

function rebuildView(keepScroll){
  var t0 = Date.now();
  var search = (DS.search || '').trim().toLowerCase();
  var fkeys = Object.keys(DS.filters).filter(function(k){ return (DS.filters[k]||'').trim(); });
  var view = [];
  var rows = DS.rows;
  var headersLen = DS.headers.length;

  for (var i = 0; i < rows.length; i++){
    var r = rows[i];
    var ok = true;
    if (fkeys.length){
      for (var fi = 0; fi < fkeys.length; fi++){
        var ci = +fkeys[fi];
        var rawN = DS.filters[fkeys[fi]];
        var needle = (rawN || '').trim();
        var neg = false;
        if (needle.charAt(0) === '!'){ neg = true; needle = needle.slice(1).trim(); }
        if (!needle) continue;
        needle = needle.toLowerCase();
        var cell = r[ci] == null ? '' : String(r[ci]);
        var hit = cell.toLowerCase().indexOf(needle) >= 0;
        if (neg ? hit : !hit){ ok = false; break; }
      }
    }
    if (ok && search){
      var found = false;
      for (var c = 0; c < headersLen && c < r.length; c++){
        var cv = r[c] == null ? '' : String(r[c]);
        if (cv.toLowerCase().indexOf(search) >= 0){ found = true; break; }
      }
      if (!found) ok = false;
    }
    if (ok) view.push(i);
  }

  if (DS.sortCol >= 0 && DS.sortDir !== 0){
    var sc = DS.sortCol, dir = DS.sortDir;
    view.sort(function(a, b){
      var va = rows[a][sc], vb = rows[b][sc];
      var na = parseFloat(va), nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb) && String(va).trim() !== '' && String(vb).trim() !== ''){
        return dir * (na - nb);
      }
      va = va == null ? '' : String(va);
      vb = vb == null ? '' : String(vb);
      return dir * va.localeCompare(vb, 'zh');
    });
  }
  DS.view = view;
  $('dwFtime').textContent = '筛选 ' + (Date.now() - t0) + 'ms';
  if (!keepScroll && scroller) scroller.scrollTop = 0;
}

/* ---------- 导入 ---------- */
async function loadTextFile(file){
  var name = file.name;
  notice('info', '读取 ' + esc(name) + ' …');
  if (/\.(xlsx|xlsm|xls)$/i.test(name) && window.XLSX){
    var ab = await file.arrayBuffer();
    var wb = XLSX.read(ab, { type: 'array', dense: true });
    var sheet = wb.SheetNames[0];
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
    if (!rows.length) throw new Error('空表');
    var headers = rows[0].map(function(h, i){ return String(h || ('列' + (i+1))); });
    var body = rows.slice(1).filter(function(r){
      return r.some(function(c){ return c !== '' && c != null; });
    }).map(function(r){
      var out = [];
      for (var i = 0; i < headers.length; i++) out.push(r[i] == null ? '' : String(r[i]));
      return out;
    });
    setDataset(name, headers, body);
    return;
  }
  var text = await file.text();
  // BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var delim = detectDelim(text);
  var raw = parseCsvFast(text, delim);
  if (!raw.length) throw new Error('空文件');
  var headers = raw[0].map(function(h, i){ return String(h || ('列' + (i+1))); });
  var body = raw.slice(1).filter(function(r){
    return r.some(function(c){ return c !== '' && c != null; });
  }).map(function(r){
    var out = [];
    for (var i = 0; i < headers.length; i++) out.push(r[i] == null ? '' : r[i]);
    return out;
  });
  setDataset(name, headers, body);
}

function setDataset(name, headers, rows){
  DS.name = name;
  DS.headers = headers;
  DS.rows = rows;
  DS.filters = {};
  DS.search = '';
  DS.sortCol = -1;
  DS.sortDir = 0;
  $('dwSearch').value = '';
  $('dwFileName').textContent = name + ' · ' + rows.length.toLocaleString('zh-CN') + ' 行 · ' + headers.length + ' 列';
  rebuildView(false);
  renderHead();
  renderVisible();
  notice('info', '已载入 ' + rows.length.toLocaleString('zh-CN') + ' 行');
  refreshColSelects();
  $('dwCleanCol').disabled = false;
  $('dwPvGroup').disabled = false;
  $('dwPvGroup2').disabled = false;
  $('dwPvVal').disabled = false;
  $('dwCmpKey').disabled = false;
}

$('dwPick').onclick = function(){ $('dwFile').click(); };
$('dwDrop').onclick = function(e){ if (e.target.tagName !== 'BUTTON') $('dwFile').click(); };
$('dwDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('dwDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('dwDrop').addEventListener('drop', function(e){
  e.preventDefault(); this.classList.remove('over');
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadTextFile(f).catch(function(err){ notice('err', '载入失败：' + esc(err.message||err)); });
});
$('dwFile').onchange = function(){
  var f = this.files && this.files[0];
  this.value = '';
  if (!f) return;
  loadTextFile(f).catch(function(err){ notice('err', '载入失败：' + esc(err.message||err)); });
};

$('dwSearch').oninput = function(){
  DS.search = this.value;
  clearTimeout(window.__dwSt);
  window.__dwSt = setTimeout(function(){ rebuildView(true); renderVisible(); }, 200);
};
$('dwResetFilter').onclick = function(){
  DS.filters = {}; DS.search = ''; DS.sortCol = -1; DS.sortDir = 0;
  $('dwSearch').value = '';
  rebuildView(false); renderHead(); renderVisible();
};

/* 样本：10 万行性能自测 */
$('dwDemo').onclick = function(){
  var n = 100000;
  var headers = ['工号','姓名','部门','月份','销售额','状态'];
  var depts = ['销售一部','销售二部','市场部','财务部','行政部'];
  var names = ['张三','李四','王五','赵六','钱七','孙八'];
  var sts = ['已确认','待确认','已作废'];
  var rows = new Array(n);
  for (var i = 0; i < n; i++){
    rows[i] = [
      'E' + (100000 + i),
      names[i % names.length] + (i % 7),
      depts[i % depts.length],
      '2024-' + ('0' + (1 + (i % 12))).slice(-2),
      String(Math.round(1000 + (i * 13) % 90000)),
      sts[i % 3]
    ];
  }
  setDataset('性能自测_10万行.csv', headers, rows);
};

/* ---------- 清洗 ---------- */
function refreshColSelects(){
  var sel = $('dwCleanCol');
  var cmp = $('dwCmpKey');
  var pv = $('dwPvGroup');
  var pv2 = $('dwPvGroup2');
  var pvv = $('dwPvVal');
  [sel, cmp, pv, pvv].forEach(function(el){
    if (!el) return;
    var cur = el.value;
    el.innerHTML = DS.headers.map(function(h, i){
      return '<option value="' + i + '">' + esc(h) + '</option>';
    }).join('');
    if (cur !== '' && +cur < DS.headers.length) el.value = cur;
  });
  if (pv2){
    var cur2 = pv2.value;
    pv2.innerHTML = '<option value="">（无）</option>' + DS.headers.map(function(h, i){
      return '<option value="' + i + '">' + esc(h) + '</option>';
    }).join('');
    if (cur2 !== '' && cur2 !== undefined) pv2.value = cur2;
  }
  // 默认数值列：找含金额/数量/额/数 的列，否则最后一列
  if (pvv && DS.headers.length){
    var guess = DS.headers.findIndex(function(h){
      return /金额|销售额|数量|合计|额|数|sum|amount|qty|count/i.test(h);
    });
    if (guess < 0) guess = DS.headers.length - 1;
    if (!pvv.value) pvv.value = String(guess);
  }
  // 载入数据后启用透视/清洗控件
  ['dwCleanCol','dwPvGroup','dwPvGroup2','dwPvVal','dwCmpKey'].forEach(function(id){
    var el = $(id);
    if (el && DS.headers.length) el.disabled = false;
  });
}

/* ---------- 透视汇总 ---------- */
var pvRows = [];
$('dwPvRun').onclick = function(){
  if (!DS.rows.length){ notice('warn', '请先载入数据'); return; }
  var g1 = +$('dwPvGroup').value || 0;
  var g2 = $('dwPvGroup2').value;
  var g2i = g2 === '' || g2 == null ? -1 : +g2;
  var vi = +$('dwPvVal').value || 0;
  var op = $('dwPvOp').value;
  var t0 = Date.now();
  var acc = Object.create(null);

  var src = DS.view.length && DS.view.length < DS.rows.length ? DS.view : null;
  var iter = function(ri){
    var r = DS.rows[ri];
    var k1 = String(r[g1] == null ? '' : r[g1]).trim() || '（空）';
    var k2 = g2i >= 0 ? String(r[g2i] == null ? '' : r[g2i]).trim() || '（空）' : '';
    var key = k2 ? (k1 + '\u0002' + k2) : k1;
    var a = acc[key];
    if (!a){
      a = acc[key] = { k1: k1, k2: k2, n: 0, sum: 0, min: Infinity, max: -Infinity };
    }
    a.n++;
    if (op !== 'count'){
      var v = parseFloat(String(r[vi] == null ? '' : r[vi]).replace(/[¥￥,，\s元]/g, ''));
      if (!isNaN(v)){
        a.sum += v;
        if (v < a.min) a.min = v;
        if (v > a.max) a.max = v;
      }
    }
  };
  if (src){
    for (var i = 0; i < src.length; i++) iter(src[i]);
  } else {
    for (var i = 0; i < DS.rows.length; i++) iter(i);
  }

  pvRows = [];
  var headers = g2i >= 0 ? [DS.headers[g1], DS.headers[g2i]] : [DS.headers[g1]];
  var opName = { sum: '求和', avg: '平均', count: '计数', min: '最小', max: '最大' }[op];
  headers.push(DS.headers[vi] + '_' + opName);
  headers.push('行数');

  Object.keys(acc).forEach(function(key){
    var a = acc[key];
    var val;
    if (op === 'count') val = a.n;
    else if (op === 'avg') val = a.n ? (a.sum / a.n) : 0;
    else if (op === 'min') val = a.min === Infinity ? 0 : a.min;
    else if (op === 'max') val = a.max === -Infinity ? 0 : a.max;
    else val = a.sum;
    if (op !== 'count') val = Math.round(val * 10000) / 10000;
    pvRows.push(g2i >= 0 ? [a.k1, a.k2, val, a.n] : [a.k1, val, a.n]);
  });
  pvRows.sort(function(x, y){
    // 按汇总值降序
    var a = typeof x[x.length-2] === 'number' ? x[x.length-2] : 0;
    var b = typeof y[y.length-2] === 'number' ? y[y.length-2] : 0;
    return b - a;
  });

  var maxShow = 200;
  var show = pvRows.slice(0, maxShow);
  var h = '<div class="rtable" style="max-height:360px"><table><thead><tr>';
  headers.forEach(function(x){ h += '<th>' + esc(x) + '</th>'; });
  h += '</tr></thead><tbody>';
  show.forEach(function(r){
    h += '<tr>';
    r.forEach(function(c){ h += '<td class="mono">' + esc(c) + '</td>'; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (pvRows.length > maxShow){
    h += '<div class="muted" style="margin-top:6px">仅显示前 ' + maxShow + ' 组，导出含全部 ' + pvRows.length + ' 组</div>';
  }
  $('dwPvOut').innerHTML = h;
  $('dwPvStat').textContent = '共 ' + pvRows.length + ' 组 · ' + opName + ' · 用时 ' + (Date.now()-t0) + 'ms' +
    (src ? '（基于当前筛选结果）' : '');
};

$('dwPvExport').onclick = function(){
  if (!pvRows.length){ notice('warn', '请先生成汇总'); return; }
  var g2i = $('dwPvGroup2').value;
  var g1 = +$('dwPvGroup').value || 0;
  var vi = +$('dwPvVal').value || 0;
  var op = $('dwPvOp').value;
  var opName = { sum: '求和', avg: '平均', count: '计数', min: '最小', max: '最大' }[op];
  var headers = g2i === '' ? [DS.headers[g1], DS.headers[vi]+'_'+opName, '行数']
    : [DS.headers[g1], DS.headers[+g2i], DS.headers[vi]+'_'+opName, '行数'];
  var csv = U.toCsv([headers].concat(pvRows), ',');
  U.saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), '透视汇总.csv');
  notice('info', '已导出 ' + pvRows.length + ' 组');
};

function applyClean(fn, label){
  if (!DS.rows.length){ notice('warn', '请先载入数据'); return; }
  var t0 = Date.now();
  var changed = 0;
  for (var i = 0; i < DS.rows.length; i++){
    var r = DS.rows[i];
    if (fn(r)) changed++;
  }
  rebuildView(true);
  renderVisible();
  notice('info', label + '，影响 ' + changed.toLocaleString('zh-CN') + ' 行（' + (Date.now()-t0) + 'ms）');
}

$('dwCleanTrim').onclick = function(){
  applyClean(function(r){
    var ch = false;
    for (var i = 0; i < r.length; i++){
      if (typeof r[i] === 'string'){
        var t = r[i].replace(/^\s+|\s+$/g, '').replace(/\s{2,}/g, ' ');
        if (t !== r[i]){ r[i] = t; ch = true; }
      }
    }
    return ch;
  }, '已去首尾空格/压缩空白');
};

$('dwCleanDedupe').onclick = function(){
  var seen = Object.create(null);
  var out = [];
  var removed = 0;
  for (var i = 0; i < DS.rows.length; i++){
    var k = DS.rows[i].join('\u0001');
    if (seen[k]){ removed++; continue; }
    seen[k] = 1;
    out.push(DS.rows[i]);
  }
  DS.rows = out;
  rebuildView(true);
  renderVisible();
  notice('info', '去重完成，删除 ' + removed.toLocaleString('zh-CN') + ' 行');
};

$('dwCleanDate').onclick = function(){
  var ci = +$('dwCleanCol').value || 0;
  applyClean(function(r){
    var v = String(r[ci] || '');
    // 2024/1/5, 2024.01.05, 20240105, 2024-1-5
    var m = v.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (!m) m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m){
      var y = m[1], mo = ('0'+m[2]).slice(-2), d = ('0'+m[3]).slice(-2);
      var nv = y + '-' + mo + '-' + d;
      if (nv !== v){ r[ci] = nv; return true; }
    }
    return false;
  }, '日期已尽量规范为 YYYY-MM-DD');
};

$('dwCleanNum').onclick = function(){
  var ci = +$('dwCleanCol').value || 0;
  applyClean(function(r){
    var v = String(r[ci] || '');
    // ¥1,234.50 / 1234元
    var m = v.replace(/[¥￥,，\s元]/g, '').replace(/[^\d.\-]/g, '');
    if (m && m !== v){ r[ci] = m; return true; }
    return false;
  }, '金额已去符号/千分位');
};

$('dwCleanEmpty2dash').onclick = function(){
  applyClean(function(r){
    var ch = false;
    for (var i = 0; i < r.length; i++){
      if (r[i] === '' || r[i] == null){ r[i] = '—'; ch = true; }
    }
    return ch;
  }, '空值已替换为 —');
};

$('dwCleanDropEmpty').onclick = function(){
  var before = DS.rows.length;
  DS.rows = DS.rows.filter(function(r){
    return r.some(function(c){ return c !== '' && c != null && c !== '—'; });
  });
  rebuildView(true);
  renderVisible();
  notice('info', '删除空行 ' + (before - DS.rows.length).toLocaleString('zh-CN') + ' 行');
};

$('dwSplit').onclick = function(){
  var ci = +$('dwCleanCol').value || 0;
  var sep = $('dwSplitSep').value || ',';
  if (sep === '\\t') sep = '\t';
  var newHeaders = [];
  var maxN = 0;
  // 预扫描
  for (var i = 0; i < Math.min(DS.rows.length, 5000); i++){
    var n = String(DS.rows[i][ci] || '').split(sep).length;
    if (n > maxN) maxN = n;
  }
  if (maxN < 2){ notice('warn', '该列未检测到分隔符 ' + sep); return; }
  for (var k = 0; k < maxN; k++) newHeaders.push(DS.headers[ci] + '_拆' + (k+1));
  var outRows = DS.rows.map(function(r){
    var parts = String(r[ci] || '').split(sep);
    var nr = r.slice(0, ci).concat(parts).concat(r.slice(ci+1));
    while (nr.length < DS.headers.length - 1 + maxN) nr.push('');
    return nr;
  });
  DS.headers = DS.headers.slice(0, ci).concat(newHeaders).concat(DS.headers.slice(ci+1));
  DS.rows = outRows;
  rebuildView(false); renderHead(); renderVisible(); refreshColSelects();
  notice('info', '已按 "' + sep + '" 拆出 ' + maxN + ' 列');
};

$('dwMerge').onclick = function(){
  var a = +$('dwCleanCol').value || 0;
  var b = +$('dwCmpKey').value || 0;
  if (a === b){ notice('warn', '请选择两列合并'); return; }
  var sep = $('dwSplitSep').value === '\\t' ? '\t' : ($('dwSplitSep').value || ' ');
  var lo = Math.min(a, b), hi = Math.max(a, b);
  var newH = DS.headers[lo] + '+' + DS.headers[hi];
  var outRows = DS.rows.map(function(r){
    var parts = String(r[lo] || '') + sep + String(r[hi] || '');
    return r.slice(0, lo).concat([parts]).concat(r.slice(lo+1, hi)).concat(r.slice(hi+1));
  });
  DS.headers = DS.headers.slice(0, lo).concat([newH]).concat(DS.headers.slice(lo+1, hi)).concat(DS.headers.slice(hi+1));
  DS.rows = outRows;
  rebuildView(false); renderHead(); renderVisible(); refreshColSelects();
  notice('info', '已合并两列');
};

/* ---------- 导出当前视图 ---------- */
function exportRows(headers, rows, basename){
  if (!rows.length){ notice('warn', '没有可导出数据'); return; }
  var csv = U.toCsv([headers].concat(rows), ',');
  U.saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), basename + '.csv');
  notice('info', '已导出 ' + rows.length.toLocaleString('zh-CN') + ' 行');
}
$('dwExportView').onclick = function(){
  var rows = DS.view.map(function(i){ return DS.rows[i]; });
  exportRows(DS.headers, rows, (DS.name || '数据').replace(/\.[^.]+$/, '') + '_筛选结果');
};
$('dwExportXlsx').onclick = async function(){
  if (!window.XLSX){ notice('err', '未加载 xlsx 库'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '生成中…';
  try{
    var rows = DS.view.map(function(i){ return DS.rows[i]; });
    var aoa = [DS.headers].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    U.saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      (DS.name || '数据').replace(/\.[^.]+$/, '') + '_筛选结果.xlsx');
    notice('info', '已导出 xlsx');
  }catch(e){
    notice('err', '导出失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '导出 XLSX';
  }
};

/* ---------- 双表比对 ---------- */
$('dwCmpPick').onclick = function(){ $('dwCmpFile').click(); };
$('dwCmpDrop').onclick = function(e){ if (e.target.tagName !== 'BUTTON') $('dwCmpFile').click(); };
$('dwCmpDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('dwCmpDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('dwCmpDrop').addEventListener('drop', function(e){
  e.preventDefault(); this.classList.remove('over');
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadCompare(f);
});
$('dwCmpFile').onchange = function(){
  var f = this.files && this.files[0];
  this.value = '';
  if (f) loadCompare(f);
};

async function loadCompare(file){
  try{
    var name = file.name, headers, body;
    if (/\.(xlsx|xlsm|xls)$/i.test(name) && window.XLSX){
      var ab = await file.arrayBuffer();
      var wb = XLSX.read(ab, { type: 'array' });
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
      headers = (rows[0] || []).map(function(h, i){ return String(h || ('列'+(i+1))); });
      body = rows.slice(1).map(function(r){
        var o = [];
        for (var i = 0; i < headers.length; i++) o.push(r[i] == null ? '' : String(r[i]));
        return o;
      });
    } else {
      var text = await file.text();
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      var raw = parseCsvFast(text, detectDelim(text));
      headers = (raw[0] || []).map(function(h, i){ return String(h || ('列'+(i+1))); });
      body = raw.slice(1).map(function(r){
        var o = [];
        for (var i = 0; i < headers.length; i++) o.push(r[i] == null ? '' : r[i]);
        return o;
      });
    }
    DS.compare = { name: name, headers: headers, rows: body };
    $('dwCmpName').textContent = name + ' · ' + body.length.toLocaleString('zh-CN') + ' 行';
    // 对齐 key 下拉：用两边同名列
    refreshCmpKeys();
    notice('info', '比对表已载入');
  }catch(e){
    notice('err', '载入比对表失败：' + esc(e.message||e));
  }
}

function refreshCmpKeys(){
  var sel = $('dwCmpKeyMain');
  if (!sel) return;
  var aHeaders = DS.headers;
  var bHeaders = DS.compare ? DS.compare.headers : [];
  var common = [];
  aHeaders.forEach(function(h, i){
    if (bHeaders.indexOf(h) >= 0) common.push({ h: h, i: i });
  });
  if (!common.length){
    common = aHeaders.map(function(h, i){ return { h: h, i: i }; });
  }
  var cur = sel.value;
  sel.innerHTML = common.map(function(c){
    return '<option value="' + c.i + '">' + esc(c.h) + (bHeaders.indexOf(c.h)>=0 ? '' : '（仅主表）') + '</option>';
  }).join('');
  if (cur !== '' && +cur < aHeaders.length) sel.value = cur;
  $('dwCmpMode').disabled = false;
}

$('dwCmpRun').onclick = function(){
  if (!DS.rows.length){ notice('warn', '请先载入主表'); return; }
  if (!DS.compare || !DS.compare.rows.length){ notice('warn', '请先载入比对表'); return; }
  var mode = $('dwCmpMode').value;
  var keyMain = +$('dwCmpKeyMain').value || 0;
  var keyName = DS.headers[keyMain];
  var keyOther = DS.compare.headers.indexOf(keyName);
  if (keyOther < 0) keyOther = +($('dwCmpKey').value) || 0;

  var t0 = Date.now();
  var mapB = Object.create(null);
  var dupB = Object.create(null);
  for (var i = 0; i < DS.compare.rows.length; i++){
    var k = String(DS.compare.rows[i][keyOther] == null ? '' : DS.compare.rows[i][keyOther]).trim();
    if (!k) continue;
    if (mapB[k]) dupB[k] = 1;
    mapB[k] = DS.compare.rows[i];
  }
  var onlyA = [], onlyB = [], both = [], diffVal = [];
  var mapA = Object.create(null);
  var matchCols = Math.min(DS.headers.length, DS.compare.headers.length);

  for (var i = 0; i < DS.rows.length; i++){
    var r = DS.rows[i];
    var k = String(r[keyMain] == null ? '' : r[keyMain]).trim();
    mapA[k] = r;
    var b = mapB[k];
    if (!b){ onlyA.push(r); continue; }
    both.push(r);
    // 值差异：按同名列比
    var diffs = [];
    for (var c = 0; c < DS.headers.length; c++){
      var bh = DS.compare.headers.indexOf(DS.headers[c]);
      if (bh < 0) continue;
      var va = String(r[c] == null ? '' : r[c]).trim();
      var vb = String(b[bh] == null ? '' : b[bh]).trim();
      if (va !== vb) diffs.push(DS.headers[c] + ': ' + va + ' ≠ ' + vb);
    }
    if (diffs.length) diffVal.push({ row: r, diffs: diffs });
  }
  for (var i = 0; i < DS.compare.rows.length; i++){
    var k = String(DS.compare.rows[i][keyOther] == null ? '' : DS.compare.rows[i][keyOther]).trim();
    if (k && !mapA[k]) onlyB.push(DS.compare.rows[i]);
  }

  var dupCount = Object.keys(dupB).length;
  $('dwCmpResult').innerHTML =
    '<div class="row" style="gap:16px;flex-wrap:wrap">' +
    '  <div><b>双方都有</b>：' + both.length.toLocaleString('zh-CN') + '</div>' +
    '  <div style="color:var(--warn)"><b>仅主表有</b>：' + onlyA.length.toLocaleString('zh-CN') + '</div>' +
    '  <div style="color:var(--err)"><b>仅比对表有</b>：' + onlyB.length.toLocaleString('zh-CN') + '</div>' +
    '  <div><b>键重复(比对表)</b>：' + dupCount.toLocaleString('zh-CN') + '</div>' +
    '  <div><b>字段不一致</b>：' + diffVal.length.toLocaleString('zh-CN') + '</div>' +
    '  <span class="muted">用时 ' + (Date.now()-t0) + 'ms · 键：' + esc(keyName) + '</span>' +
    '</div>';

  window.__dwCmpOut = { onlyA: onlyA, onlyB: onlyB, both: both, diffVal: diffVal, keyName: keyName, keyOther: keyOther };
  notice('info', '比对完成：仅主表 ' + onlyA.length + ' · 仅比对表 ' + onlyB.length + ' · 字段差异 ' + diffVal.length);

  if (mode === 'showA'){
    // 只在主表里显示仅主表有的
    var set = Object.create(null);
    onlyA.forEach(function(r){ set[String(r[keyMain]).trim()] = 1; });
    DS.filters = {}; DS.search = '';
    // 用 view 过滤
    DS.view = [];
    for (var i = 0; i < DS.rows.length; i++){
      var k = String(DS.rows[i][keyMain] == null ? '' : DS.rows[i][keyMain]).trim();
      if (set[k]) DS.view.push(i);
    }
    renderVisible();
  } else if (mode === 'showDiff'){
    var set2 = Object.create(null);
    diffVal.forEach(function(d){ set2[String(d.row[keyMain]).trim()] = 1; });
    DS.view = [];
    for (var i = 0; i < DS.rows.length; i++){
      var k = String(DS.rows[i][keyMain] == null ? '' : DS.rows[i][keyMain]).trim();
      if (set2[k]) DS.view.push(i);
    }
    renderVisible();
  } else {
    rebuildView(true);
    renderVisible();
  }
};

$('dwCmpExpOnlyA').onclick = function(){
  var o = window.__dwCmpOut;
  if (!o){ notice('warn', '请先比对'); return; }
  exportRows(DS.headers, o.onlyA, '仅主表有_' + (o.onlyA.length));
};
$('dwCmpExpOnlyB').onclick = function(){
  var o = window.__dwCmpOut;
  if (!o){ notice('warn', '请先比对'); return; }
  exportRows(DS.compare.headers, o.onlyB, '仅比对表有_' + (o.onlyB.length));
};
$('dwCmpExpDiff').onclick = function(){
  var o = window.__dwCmpOut;
  if (!o){ notice('warn', '请先比对'); return; }
  var rows = o.diffVal.map(function(d){
    return d.row.concat([d.diffs.join(' | ')]);
  });
  var headers = DS.headers.concat(['差异说明']);
  exportRows(headers, rows, '字段不一致_' + rows.length);
};

/* 初始化 */
ensureDom();
if (scroller){
  scroller.addEventListener('scroll', function(){
    clearTimeout(window.__dwSc);
    // 直接画，避免延迟；10万行下足够轻
    renderVisible();
  });
}
window.addEventListener('resize', function(){ renderVisible(); });
renderVisible();

// 初始空表头，方便看见布局
DS.headers = ['（请载入 CSV / XLSX，或点「生成 10 万行演示」）'];
DS.rows = [];
DS.view = [];
renderHead();
})();
