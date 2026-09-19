/* ============ 数据工作台：大表虚拟滚动 + 清洗 + 双表比对 ============ */
'use strict';
(function(){
var U = TB.util;
var C0 = TB.dataCore || {};   /* 纯函数核心：js/data-core.js */
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

/* 统一解析：CSV / TSV / TXT / XLSX → {name, headers, rows}
 * 抽出来是为了让「多表合并」复用同一套解析逻辑，避免两处实现走偏。
 * 顺带修掉原来的写法：xlsx 与 csv 两条分支在同一个函数作用域里
 * 重复声明了 headers/body（var 提升导致能跑但很危险）。 */
async function parseAnyFile(file){
  var name = file.name;
  if (/\.(xlsx|xlsm|xls)$/i.test(name)){
    await TB.loadVendor('xlsx');   /* 按需加载；失败会 throw，由调用方 catch 统一提示 */
    var ab = await file.arrayBuffer();
    var wb = XLSX.read(ab, { type: 'array', dense: true });
    var sheet = wb.SheetNames[0];
    var xrows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
    if (!xrows.length) throw new Error('空表');
    var xheaders = xrows[0].map(function(h2, i2){ return String(h2 || ('列' + (i2+1))); });
    var xbody = xrows.slice(1).filter(function(r){
      return r.some(function(c){ return c !== '' && c != null; });
    }).map(function(r){
      var out = [];
      for (var i2 = 0; i2 < xheaders.length; i2++) out.push(r[i2] == null ? '' : String(r[i2]));
      return out;
    });
    return { name: name, headers: xheaders, rows: xbody };
  }

  var text = await file.text();
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // 去掉 BOM
  var raw = parseCsvFast(text, detectDelim(text));
  if (!raw.length) throw new Error('空文件');
  var headers = raw[0].map(function(h, i){ return String(h || ('列' + (i+1))); });
  var body = raw.slice(1).filter(function(r){
    return r.some(function(c){ return c !== '' && c != null; });
  }).map(function(r){
    var out = [];
    for (var i = 0; i < headers.length; i++) out.push(r[i] == null ? '' : r[i]);
    return out;
  });
  return { name: name, headers: headers, rows: body };
}

async function loadTextFile(file){
  notice('info', '读取 ' + esc(file.name) + ' …');
  var t = await parseAnyFile(file);
  setDataset(t.name, t.headers, t.rows);   // setDataset 内部会重置清洗管线
  U.oplog.add('载入数据', t.name + '（' + t.headers.length + ' 列）', null, t.rows.length);
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

  /* 换了一批数据，旧的清洗步骤与撤销记录按列名对不上了，一律清空更安全 */
  PIPE.steps = [];
  PIPE.undo = [];
  renderPipe();
  if ($('dwCleanOut')) $('dwCleanOut').innerHTML = '';

  ['dwCleanCol','dwPvGroup','dwPvGroup2','dwPvVal','dwCmpKey'].forEach(function(id){
    var el = $(id);
    if (el) el.disabled = false;
  });
  /* 通知其它模块（数据批处理的多表合并 / 按列拆表）刷新自己的列下拉 */
  document.dispatchEvent(new CustomEvent('tb:dataset'));
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
  var xtR = $('dwXtRow'), xtC = $('dwXtCol'), xtV = $('dwXtVal');
  [sel, cmp, pv, pvv, xtR, xtC, xtV].forEach(function(el){
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
  var guessNum = DS.headers.length - 1;
  if (DS.headers.length){
    var g = DS.headers.findIndex(function(h){
      return /金额|销售额|数量|合计|额|数|sum|amount|qty|count/i.test(h);
    });
    if (g >= 0) guessNum = g;
  }
  if (pvv && !pvv.value && DS.headers.length) pvv.value = String(guessNum);
  if (xtV && !xtV.value && DS.headers.length) xtV.value = String(guessNum);
  if (xtR && !xtR.value && DS.headers.length) xtR.value = '0';
  if (xtC && !xtC.value && DS.headers.length > 1) xtC.value = '1';
  // 载入数据后启用透视/清洗/交叉表控件
  ['dwCleanCol','dwPvGroup','dwPvGroup2','dwPvVal','dwCmpKey','dwXtRow','dwXtCol','dwXtVal'].forEach(function(id){
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

/* ---------- 清洗管线：可加多步、先预览再执行、可撤销 ---------- */
var PIPE = { steps: [], undo: [], header: [] };

function syncCleanButtons(){
  var has = PIPE.steps.length > 0;
  $('dwCleanPrev').disabled = !has;
  $('dwCleanApply').disabled = !has;
  $('dwCleanReset').disabled = !has;
  $('dwCleanUndo').disabled = !PIPE.undo.length;
}

function renderPipe(){
  var box = $('dwPipe');
  if (!PIPE.steps.length){
    box.innerHTML = '<span class="muted">还没有步骤。选好操作与列，点「＋ 添加步骤」。</span>';
    syncCleanButtons();
    return;
  }
  var h = '';
  PIPE.steps.forEach(function(s, i){
    h += '<span class="chip">' + (i + 1) + '. ' + esc(C0.describeStep(s, DS.headers)) +
         '<button class="x" data-i="' + i + '" title="删除这一步">×</button></span>';
  });
  box.innerHTML = h;
  box.querySelectorAll('button.x').forEach(function(b){
    b.onclick = function(){
      PIPE.steps.splice(+b.dataset.i, 1);
      renderPipe();
      $('dwCleanOut').innerHTML = '';
    };
  });
  syncCleanButtons();
}

/* 操作下拉与参数字段都由 OPS 表驱动，避免两处手写对不上 */
function refreshOpFields(){
  var op = $('dwCleanOp').value;
  var o = C0.OPS[op] || {};
  $('dwCleanArgWrap').style.display = o.args > 0 ? '' : 'none';
  $('dwCleanArg2Wrap').style.display = o.args > 1 ? '' : 'none';
  if (o.args > 0) $('dwCleanArg').placeholder = o.arg1 || '参数';
  if (o.arg2) $('dwCleanArg2').placeholder = o.arg2;
  if (o.args > 0 && $('dwCleanArg').value === '' && o.defaultArg) $('dwCleanArg').value = o.defaultArg;
  $('dwCleanColWrap').style.display = o.needsCol === false ? 'none' : '';
  $('dwCleanOpHint').textContent = o.needsCol === false ? '这一步作用于整行，不需要选列' : '';
}

function initOpSelect(){
  var sel = $('dwCleanOp');
  sel.innerHTML = Object.keys(C0.OPS).map(function(k){
    return '<option value="' + k + '">' + esc(C0.OPS[k].label) + '</option>';
  }).join('');
  sel.onchange = refreshOpFields;
  refreshOpFields();
}

function addPipeStep(){
  if (!DS.rows.length){ notice('warn', '请先载入数据'); return; }
  var op = $('dwCleanOp').value;
  var o = C0.OPS[op] || {};
  var arg = $('dwCleanArg').value;
  var arg2 = $('dwCleanArg2').value;
  if (o.args > 0 && arg === ''){ notice('warn', '这一步需要填「' + (o.arg1 || '参数') + '」'); $('dwCleanArg').focus(); return; }
  if (o.args > 1 && arg2 === ''){ notice('warn', '这一步需要填「' + (o.arg2 || '第二个参数') + '」'); $('dwCleanArg2').focus(); return; }
  var ci = +$('dwCleanCol').value;
  if (isNaN(ci)) ci = 0;
  PIPE.steps.push({ op: op, col: ci, colName: DS.headers[ci], arg: arg, arg2: arg2 });
  renderPipe();
  $('dwCleanOut').innerHTML = '';
}

function previewPipe(){
  if (!DS.rows.length){ notice('warn', '请先载入数据'); return; }
  if (!PIPE.steps.length){ notice('warn', '还没有清洗步骤'); return; }
  var r = C0.applyPipeline(DS.headers, DS.rows, PIPE.steps, 300);
  var h = '<div style="margin-bottom:8px"><b>预览前 ' + r.rows.length.toLocaleString('zh-CN') + ' 行</b>（共 ' +
          r.total.toLocaleString('zh-CN') + ' 行）。步骤生效后的表头：' +
          esc(r.headers.join(' | ')) + '　<span class="muted">确认没问题再点「执行」</span></div>';
  h += C0.tableHtml(r.headers, r.rows);
  if (r.logs.length) h += '<div class="muted" style="margin-top:8px;color:#92400e">提示：<br>· ' + r.logs.map(esc).join('<br>· ') + '</div>';
  $('dwCleanOut').innerHTML = h;
}

function applyPipe(){
  if (!DS.rows.length){ notice('warn', '请先载入数据'); return; }
  if (!PIPE.steps.length){ notice('warn', '还没有清洗步骤'); return; }
  PIPE.undo.push({
    name: DS.name,
    headers: DS.headers.slice(),
    rows: DS.rows.map(function(r){ return r.slice(); })
  });
  if (PIPE.undo.length > 3) PIPE.undo.shift();   // 最多回退 3 次，避免吃内存

  var beforeRows = DS.rows.length;
  var r = C0.applyPipeline(DS.headers, DS.rows, PIPE.steps);
  U.oplog.add('清洗执行', PIPE.steps.length + ' 步：' +
    (r.logs && r.logs.length ? r.logs.join('；')
     : PIPE.steps.map(function(s){ return C0.describeStep(s, DS.headers); }).join('；')),
    beforeRows, r.rows.length);
  DS.rows = r.rows;
  DS.headers = r.headers;
  DS.filters = {}; DS.search = ''; DS.sortCol = -1; DS.sortDir = 0;
  $('dwSearch').value = '';
  rebuildView(false); renderHead(); renderVisible(); refreshColSelects();
  $('dwCleanOut').innerHTML =
    '<div style="color:#15803d"><b>✓ 已执行 ' + PIPE.steps.length + ' 步</b>，当前 ' +
    r.total.toLocaleString('zh-CN') + ' 行 × ' + r.headers.length + ' 列。' +
    '如需还原，点「撤销执行」。</div>' +
    (r.logs.length ? '<div class="muted" style="margin-top:6px;color:#92400e">· ' + r.logs.map(esc).join('<br>· ') + '</div>' : '') +
    '<div style="margin-top:10px">' + C0.tableHtml(r.headers, r.rows.slice(0, 10)) + '</div>';
  notice('info', '清洗已执行');
   syncCleanButtons();   /* 执行后「撤销执行」要立刻可用 */
}

function undoPipe(){
  if (!PIPE.undo.length){ notice('warn', '没有可撤销的操作'); return; }
  var s = PIPE.undo.pop();
  DS.name = s.name; DS.headers = s.headers; DS.rows = s.rows;
  DS.filters = {}; DS.search = ''; DS.sortCol = -1; DS.sortDir = 0;
  $('dwSearch').value = '';
  rebuildView(false); renderHead(); renderVisible(); refreshColSelects();
  $('dwCleanOut').innerHTML = '<div style="color:#15803d"><b>✓ 已撤销</b>，数据回到执行前（还可撤销 ' + PIPE.undo.length + ' 次）</div>';
  U.oplog.add('清洗撤销', '数据回到执行前', null, DS.rows.length);
  notice('info', '已撤销上一步清洗');
   syncCleanButtons();
}

$('dwCleanAdd').onclick = addPipeStep;
$('dwCleanPrev').onclick = previewPipe;
$('dwCleanApply').onclick = applyPipe;
$('dwCleanReset').onclick = function(){
  PIPE.steps = []; PIPE.undo = [];
  renderPipe();
  $('dwCleanOut').innerHTML = '';
};
$('dwCleanUndo').onclick = undoPipe;

/* ---------- 清洗方案：命名保存 / 一键重跑 / 导出导入（§3.1③） ---------- */
var RECIPE_KEY = 'tb-clean-recipes';

function loadRecipes(){
  try{
    var raw = localStorage.getItem(RECIPE_KEY);
    return raw ? JSON.parse(raw) : {};
  }catch(e){ return {}; }
}
function saveRecipes(obj){
  try{ localStorage.setItem(RECIPE_KEY, JSON.stringify(obj)); return true; }
  catch(e){ notice('err','保存失败：'+esc(e.message||e)); return false; }
}
function refreshRecipeSel(){
  var sel = $('dwRecipeSel');
  if (!sel) return;
  var map = loadRecipes();
  var cur = sel.value;
  var names = Object.keys(map).sort();
  sel.innerHTML = '<option value="">（未保存的方案）</option>' + names.map(function(n){
    return '<option value="' + esc(n) + '">' + esc(n) + '（' + map[n].steps.length + ' 步）</option>';
  }).join('');
  if (cur && map[cur]) sel.value = cur;
}
function applyRecipe(steps){
  if (!steps || !steps.length){ notice('warn','方案为空'); return; }
  if (!DS.headers.length){ notice('warn','请先载入数据再套用方案'); return; }
  var mapped = [], skipped = [];
  steps.forEach(function(s){
    var ci = -1;
    if (s.colName != null) ci = DS.headers.indexOf(s.colName);
    if (ci < 0 && s.col != null && s.col < DS.headers.length && !s.colName) ci = s.col;
    if (ci < 0 && s.col != null && s.col < DS.headers.length &&
        (s.colName == null || DS.headers[s.col] === s.colName)) ci = s.col;
    if (ci < 0){
      skipped.push(s.colName || ('第' + ((s.col||0)+1) + '列'));
      return;
    }
    mapped.push({ op: s.op, col: ci, colName: DS.headers[ci], arg: s.arg, arg2: s.arg2 });
  });
  PIPE.steps = mapped;
  renderPipe();
  $('dwCleanOut').innerHTML = skipped.length
    ? '<div class="notice warn" style="margin:0">已载入 ' + mapped.length + ' 步；列名对不上跳过：' + esc(skipped.join('、')) + '</div>'
    : '';
  notice('info','已载入方案，' + mapped.length + ' 步' + (skipped.length ? '，跳过 ' + skipped.length + ' 步' : ''));
}

if ($('dwRecipeSave')) $('dwRecipeSave').onclick = function(){
  if (!PIPE.steps.length){ notice('warn','先添加清洗步骤再保存'); return; }
  var name = ($('dwRecipeName').value || '').trim();
  if (!name){ notice('warn','请填写方案名'); $('dwRecipeName').focus(); return; }
  var map = loadRecipes();
  map[name] = { steps: PIPE.steps.slice(), savedAt: Date.now(), note: '含 ' + PIPE.steps.length + ' 步' };
  if (!saveRecipes(map)) return;
  refreshRecipeSel();
  $('dwRecipeSel').value = name;
  notice('info','方案「' + esc(name) + '」已保存（本机浏览器）');
};
if ($('dwRecipeLoad')) $('dwRecipeLoad').onclick = function(){
  var name = $('dwRecipeSel').value;
  if (!name){ notice('warn','请选择要载入的方案'); return; }
  var map = loadRecipes();
  if (!map[name]){ notice('warn','方案不存在'); refreshRecipeSel(); return; }
  applyRecipe(map[name].steps);
};
if ($('dwRecipeDel')) $('dwRecipeDel').onclick = function(){
  var name = $('dwRecipeSel').value;
  if (!name){ notice('warn','请选择要删除的方案'); return; }
  if (!confirm('删除方案「' + name + '」？')) return;
  var map = loadRecipes();
  delete map[name];
  saveRecipes(map);
  refreshRecipeSel();
  notice('info','已删除');
};
if ($('dwRecipeExport')) $('dwRecipeExport').onclick = function(){
  var map = loadRecipes();
  var names = Object.keys(map);
  if (!names.length){ notice('warn','本机还没有保存过方案'); return; }
  var payload = { kind: 'office-toolbox-clean-recipes', version: 1, recipes: map, exportedAt: new Date().toISOString() };
  U.saveBlob(new Blob([JSON.stringify(payload, null, 2)], { type:'application/json;charset=utf-8' }), '清洗方案.json');
  notice('info','已导出 ' + names.length + ' 个方案，可发给同事导入');
};
if ($('dwRecipeImport')) $('dwRecipeImport').onclick = function(){ $('dwRecipeFile').click(); };
if ($('dwRecipeFile')) $('dwRecipeFile').onchange = async function(){
  var f = this.files && this.files[0];
  this.value = '';
  if (!f) return;
  try{
    var obj = JSON.parse(await f.text());
    var rec = (obj && obj.recipes) || {};
    if (!Object.keys(rec).length) throw new Error('文件里没有方案');
    var map = loadRecipes();
    var n = 0;
    Object.keys(rec).forEach(function(k){
      if (rec[k] && rec[k].steps) { map[k] = rec[k]; n++; }
    });
    saveRecipes(map);
    refreshRecipeSel();
    notice('info','已导入 ' + n + ' 个方案');
  }catch(e){
    notice('err','导入失败：' + esc(e.message||e));
  }
};
refreshRecipeSel();

initOpSelect();
renderPipe();


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
  var btn = this; btn.disabled = true; btn.textContent = '生成中…';
  try{
    await TB.loadVendor('xlsx');
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
$('dwExpReport').onclick = function(){
  var rows = U.oplog.rows();
  if (!rows.length){ notice('info', '本次会话还没做过任何操作，没有报告可导。'); return; }
  var csv = U.toCsv([['时间','操作','明细','行数(前)','行数(后)']].concat(rows));
  U.saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), '处理报告.csv');
  notice('info', '已导出 处理报告.csv（' + rows.length + ' 条操作记录）');
};

/* ---------- 双表比对（对账）：A 表＝工作台当前数据，B 表＝拖入的比对表 ---------- */
var CMP = { name: '', headers: [], rows: [], result: null };

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
    var t = await parseAnyFile(file);
    CMP.name = t.name; CMP.headers = t.headers; CMP.rows = t.rows;
    CMP.result = null;
    $('dwCmpName').textContent = t.name + ' · ' + t.rows.length.toLocaleString('zh-CN') + ' 行 × ' + t.headers.length + ' 列';
    $('dwCmpKey2').innerHTML = t.headers.map(function(h, i){
      return '<option value="' + i + '">' + esc(h) + '</option>';
    }).join('');
    /* 猜一个匹配列：优先挑与 A 表同名的列，省得用户自己找 */
    var guess = -1;
    for (var i = 0; i < t.headers.length; i++){
      if (DS.headers.indexOf(t.headers[i]) >= 0){ guess = i; break; }
    }
    if (guess >= 0) $('dwCmpKey2').value = String(guess);
    $('dwCmpKey2').disabled = false;
    $('dwCmpDiffOnly').disabled = true;
    $('dwCmpExport').disabled = true;
    $('dwCmpStat').textContent = '';
    $('dwCmpOut').innerHTML = '';
    notice('info', '比对表已载入，选好两边的匹配列后点「开始比对」');
  }catch(e){
    notice('err', '载入比对表失败：' + esc(e.message||e));
  }
}

function cmpOptions(){
  return {
    fuzzy: $('dwCmpFuzzy').checked,
    threshold: (+$('dwCmpThresh').value || 80) / 100,
    ignoreCase: $('dwCmpCase').checked,
    normalize: $('dwCmpNorm').checked,
  };
}

function runCompare(){
  if (!DS.rows.length){ notice('warn', '请先载入主表（数据源）'); return; }
  if (!CMP.rows.length){ notice('warn', '请先载入要比对的表'); return; }
  var k1 = +$('dwCmpKey').value, k2 = +$('dwCmpKey2').value;
  if (isNaN(k1) || isNaN(k2)){ notice('warn', '请选择两张表的匹配列'); return; }
  var opt = cmpOptions();

  /* 参与比较的列 = 两表表头的并集，去掉各自的匹配列 */
  var seen = {}, cmpCols = [];
  DS.headers.forEach(function(h, i){
    if (i !== k1 && !seen[h]){ seen[h] = 1; cmpCols.push({ name: h, idx1: i, idx2: CMP.headers.indexOf(h) }); }
  });
  CMP.headers.forEach(function(h, i){
    if (i !== k2 && !seen[h]){ seen[h] = 1; cmpCols.push({ name: h, idx1: DS.headers.indexOf(h), idx2: i }); }
  });
  var missing = cmpCols.filter(function(c){ return c.idx1 < 0 || c.idx2 < 0; })
                       .map(function(c){ return c.name + '（只有' + (c.idx1 < 0 ? '比对表' : '主表') + '有）'; });

  /* B 表按匹配值建索引；同一个匹配值出现多次时按先后顺序取用 */
  var byKey = {};
  CMP.rows.forEach(function(r){
    var k = C0.cmpKey(String(r[k2] == null ? '' : r[k2]), opt);
    if (k === '') return;
    (byKey[k] = byKey[k] || []).push(r);
  });

  var t0 = Date.now();
  var diff = 0, same = 0, only1 = 0, only2 = 0, fuzz = 0;
  var out = [];

  DS.rows.forEach(function(r){
    var raw = String(r[k1] == null ? '' : r[k1]);
    var k = C0.cmpKey(raw, opt);
    var partner = null;
    if (byKey[k] && byKey[k].length){ partner = byKey[k].shift(); }
    else if (opt.fuzzy && raw !== ''){
      var keys = Object.keys(byKey), best = null;
      for (var i = 0; i < keys.length; i++){
        if (!byKey[keys[i]].length) continue;
        var sc = C0.similarity(raw, keys[i]);
        if (!best || sc > best.score) best = { key: keys[i], score: sc };
      }
      if (best && best.score >= opt.threshold){ partner = byKey[best.key].shift(); fuzz++; }
    }
    if (!partner){ only1++; out.push([raw, '主表独有', '比对表里找不到这一项']); return; }

    var changed = [];
    cmpCols.forEach(function(cc){
      if (cc.idx1 < 0 || cc.idx2 < 0) return;   // 缺列不当作差异，已在提示里说明
      var a = String(r[cc.idx1] == null ? '' : r[cc.idx1]);
      var b = String(partner[cc.idx2] == null ? '' : partner[cc.idx2]);
      if (C0.cmpEq(a, b, opt)) return;
      changed.push(cc.name + '：' + (a === '' ? '(空)' : a) + ' → ' + (b === '' ? '(空)' : b));
    });
    if (changed.length){ diff++; out.push([raw, '有差异', changed.join('；')]); }
    else { same++; out.push([raw, '一致', '']); }
  });

  Object.keys(byKey).forEach(function(k){
    byKey[k].forEach(function(r){
      only2++;
      out.push([String(r[k2] == null ? '' : r[k2]), '比对表独有', '主表里找不到这一项']);
    });
  });

  CMP.result = { rows: out };
  $('dwCmpStat').innerHTML =
    '一致 <b style="color:#15803d">' + same + '</b>　' +
    '有差异 <b style="color:#b45309">' + diff + '</b>　' +
    '主表独有 <b>' + only1 + '</b>　' +
    '比对表独有 <b>' + only2 + '</b>　' +
    '<span class="muted">用时 ' + (Date.now() - t0) + 'ms</span>' +
    (fuzz ? '　<span class="muted">（其中 ' + fuzz + ' 条靠模糊匹配对上）</span>' : '') +
    (missing.length ? '<div class="muted" style="margin-top:4px">未参与比较：' + esc(missing.join('、')) + '</div>' : '');
  if (!opt.fuzzy && only1) {
    /* 提示：名称写法有差异时开模糊匹配能救回来 */
    $('dwCmpStat').innerHTML += '<div class="muted" style="margin-top:4px">如果两边名称只是写法不同（全角/括号/「有限公司」），勾选「模糊匹配」再比一次。</div>';
  }

  U.oplog.add('双表对账', DS.name + ' ↔ ' + CMP.name + (opt.fuzzy ? '（模糊匹配）' : '') +
    '：一致 ' + same + '、差异 ' + diff + '、主表独有 ' + only1 + '、比对表独有 ' + only2, null, null);
  renderCmpRows();
  $('dwCmpExport').disabled = false;
  $('dwCmpDiffOnly').disabled = (diff + only1 + only2) === 0;
}

function renderCmpRows(){
  if (!CMP.result){ $('dwCmpOut').innerHTML = ''; return; }
  var rows = CMP.result.rows;
  if ($('dwCmpDiffOnly').checked){
    rows = rows.filter(function(r){ return r[1] !== '一致'; });
  }
  if (!rows.length){
    $('dwCmpOut').innerHTML = '<div style="color:#15803d;padding:6px 0">✓ 两张表完全一致</div>';
    return;
  }
  var h = '<div class="rtable" style="max-height:380px;overflow:auto"><table><thead><tr>' +
          '<th>匹配值</th><th>情况</th><th>差异明细</th></tr></thead><tbody>';
  var show = Math.min(rows.length, 500);
  for (var i = 0; i < show; i++){
    var r = rows[i];
    h += '<tr class="' + (r[1] === '有差异' ? 'warn' : (r[1] === '一致' ? '' : 'diff')) + '">' +
         '<td class="mono">' + esc(r[0]) + '</td><td>' + esc(r[1]) +
         '</td><td class="mono">' + esc(r[2] || '') + '</td></tr>';
  }
  h += '</tbody></table></div>';
  if (rows.length > show) h += '<div class="muted" style="margin-top:6px">仅列出前 ' + show + ' 行，共 ' + rows.length.toLocaleString('zh-CN') + ' 行</div>';
  $('dwCmpOut').innerHTML = h;
}

$('dwCmpFuzzy').onchange = function(){ $('dwCmpThreshRow').style.display = this.checked ? '' : 'none'; };
$('dwCmpThresh').oninput = function(){ $('dwCmpThreshVal').textContent = this.value + '%'; };
$('dwCmpDiffOnly').onchange = renderCmpRows;
$('dwCmpRun').onclick = runCompare;
$('dwCmpExport').onclick = function(){
  if (!CMP.result){ notice('warn', '请先比对'); return; }
  exportRows(['匹配值', '情况', '差异明细'], CMP.result.rows, '对账结果');
};


/* 初始化 */
ensureDom();
if (scroller){
  scroller.addEventListener('scroll', function(){
    clearTimeout(window.__dwSc);
    renderVisible();
  });
}
window.addEventListener('resize', function(){ renderVisible(); });
renderVisible();

DS.headers = ['（请载入 CSV / XLSX，或点「生成 10 万行演示」）'];
DS.rows = [];
DS.view = [];
renderHead();

/* ---------- 对外接口：供 js/data-batch.js（多表合并 / 按列拆表）复用 ---------- */

function fillColSelect(el, pickFn){
  if (!el) return;
  var cur = el.value;
  el.innerHTML = DS.headers.map(function(h,i){
    return '<option value="'+i+'">'+esc(h)+'</option>';
  }).join('');
  if (pickFn) el.value = String(pickFn());
  else if (cur !== '' && +cur < DS.headers.length) el.value = cur;
}

function guessNumCol(){
  var g = DS.headers.findIndex(function(h){
    return /金额|销售额|数量|合计|额|数|sum|amount|qty/i.test(h);
  });
  return g >= 0 ? g : Math.max(0, DS.headers.length - 1);
}

/* 可选：透视结果点行回查明细 */
function filterByGroup(colIdx, value){
  DS.filters = {};
  DS.filters[colIdx] = String(value);
  if (typeof rebuildView === 'function') rebuildView(true);
  if (typeof renderHead === 'function') renderHead();
  if (typeof renderVisible === 'function') renderVisible();
  notice('info','已在主表中筛选：' + esc(DS.headers[colIdx] || '') + ' = ' + esc(value));
}

/* 交叉表 */
function renderCrosstab(){
  if (!DS.rows.length){ notice('warn','请先载入数据'); return; }
  var rowCol = +$('dwXtRow').value || 0;
  var colCol = +$('dwXtCol').value || 0;
  var valCol = +$('dwXtVal').value || 0;
  var op = $('dwXtOp').value;
  if (rowCol === colCol){ notice('warn','行分组与列分组不能相同'); return; }
  var t0 = Date.now();
  var data = { headers: DS.headers, rows: DS.rows };
  if (!C0.crosstab){ notice('err','交叉表核心未加载'); return; }
  XT = C0.crosstab(data, rowCol, colCol, valCol, op);
  var opName = {sum:'求和',avg:'平均',count:'计数'}[op] || op;
  var h = '<div class="rtable" style="max-height:360px"><table><thead><tr><th>'+esc(DS.headers[rowCol])+' \\ '+esc(DS.headers[colCol])+'</th>';
  XT.colLabels.forEach(function(c){ h += '<th>'+esc(c)+'</th>'; });
  h += '<th>合计</th></tr></thead><tbody>';
  var maxR = Math.min(XT.rowLabels.length, 80);
  for (var i=0;i<maxR;i++){
    h += '<tr><td class="mono">'+esc(XT.rowLabels[i])+'</td>';
    XT.cells[i].forEach(function(v){ h += '<td class="mono">'+v+'</td>'; });
    h += '<td class="mono"><b>'+XT.rowTotals[i]+'</b></td></tr>';
  }
  if (XT.rowLabels.length > maxR){
    h += '<tr><td class="muted">…其余 '+ (XT.rowLabels.length-maxR) +' 行见导出</td><td colspan="'+(XT.colLabels.length+1)+'"></td></tr>';
  }
  h += '<tr><td><b>列合计</b></td>';
  XT.colTotals.forEach(function(v){ h += '<td class="mono"><b>'+v+'</b></td>'; });
  h += '<td class="mono"><b>'+XT.grand+'</b></td></tr>';
  h += '</tbody></table></div>';
  $('dwXtOut').innerHTML = h;
  $('dwXtStat').textContent = '共 '+XT.rowLabels.length+' 行 × '+XT.colLabels.length+' 列 · '+opName+' · 总计 '+XT.grand+' · '+(Date.now()-t0)+'ms';
  $('dwXtExport').disabled = false;
  if (U.oplog) U.oplog.add('交叉表', DS.headers[rowCol]+'×'+DS.headers[colCol]+' '+opName+'：'+XT.rowLabels.length+'×'+XT.colLabels.length);
}

$('dwXtRun').onclick = renderCrosstab;
$('dwXtExport').onclick = function(){
  if (!XT){ notice('warn','请先生成交叉表'); return; }
  var rh = DS.headers[(+$('dwXtRow').value)||0];
  var rows = [];
  rows.push([rh].concat(XT.colLabels).concat(['合计']));
  for (var i=0;i<XT.rowLabels.length;i++){
    rows.push([XT.rowLabels[i]].concat(XT.cells[i]).concat([XT.rowTotals[i]]));
  }
  rows.push(['列合计'].concat(XT.colTotals).concat([XT.grand]));
  exportRows(rows[0], rows.slice(1), '交叉表');
};

/* 公式列 */
$('dwFmHelp').onclick = function(){
  if (!DS.headers.length){ notice('info','先载入数据。示例：税额 = [金额] * 0.13  或  合计 = [数量] * [单价]'); return; }
  var num = DS.headers[guessNumCol()];
  $('dwFmExpr').value = '新列 = [' + num + '] * 1.13';
  notice('info','已填入示例，可改成你需要的公式');
};
$('dwFmRun').onclick = function(){
  if (!DS.rows.length){ notice('warn','请先载入数据'); return; }
  var formula = $('dwFmExpr').value;
  var t0 = Date.now();
  var res = C0.applyFormulaColumn({ headers: DS.headers, rows: DS.rows }, formula);
  if (!res.ok){ notice('err', res.err || '公式无效'); return; }
  DS.headers = res.headers;
  DS.rows = res.rows;
  rebuildView(false);
  renderHead();
  renderVisible();
  refreshColSelects();
  var oplog = U.oplog;
  if (oplog) oplog.add('公式列', formula + ' → ' + res.name + '（' + res.rows.length + ' 行）');
  $('dwFmStat').textContent = '已添加列「'+res.name+'」· 空值 ' + res.bad + ' 行 · ' + (Date.now()-t0) + 'ms';
  notice('info','公式列「'+esc(res.name)+'」已加入');
};

/* 图表：基于最近透视或交叉表首行系列 */
function drawChart(kind){
  var canvas = $('dwPvCanvas');
  if (!canvas){ notice('err','画布不可用'); return; }
  var labels = null, values = null, title = '';
  if (PV && PV.labels && PV.labels.length){
    labels = PV.labels; values = PV.values; title = PV.title || '透视汇总';
  } else if (XT && XT.rowLabels.length){
    labels = XT.rowLabels.slice(0, 20);
    values = XT.rowTotals.slice(0, 20);
    title = '交叉表合计（前'+labels.length+'行）';
  } else {
    notice('warn','请先生成「透视汇总」或「交叉表」再画图');
    return;
  }
  var W = canvas.width, H = canvas.height;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#1f2937';
  ctx.font = '14px system-ui,sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 12, 22);

  var maxV = 0;
  values.forEach(function(v){ if (v > maxV) maxV = v; });
  if (maxV <= 0) maxV = 1;

  var n = Math.min(labels.length, 20);
  var pad = { l: 48, r: 16, t: 40, b: 48 };
  var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  if (kind === 'pie'){
    var cx = W/2, cy = pad.t + ih/2, R = Math.min(iw, ih)/2 - 8;
    var total = 0;
    for (var i=0;i<n;i++) total += Math.max(0, values[i]);
    if (total <= 0) total = 1;
    var angle = -Math.PI/2;
    var colors = ['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#db2777','#65a30d'];
    for (var i=0;i<n;i++){
      var slice = Math.max(0, values[i]) / total * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      angle += slice;
    }
    // legend
    var ly = pad.t;
    ctx.font = '12px system-ui,sans-serif';
    for (var i=0;i<n;i++){
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(W - 140, ly + i*16, 10, 10);
      ctx.fillStyle = '#334155';
      var lab = String(labels[i]);
      if (lab.length > 10) lab = lab.slice(0,10)+'…';
      ctx.fillText(lab + ' ' + values[i], W - 124, ly + i*16 + 9);
    }
  } else {
    // bar
    var barW = iw / n * 0.7;
    var gap = iw / n * 0.3;
    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + ih);
    ctx.lineTo(pad.l + iw, pad.t + ih);
    ctx.stroke();
    for (var i=0;i<n;i++){
      var h = Math.max(2, (Math.max(0, values[i]) / maxV) * ih);
      var x = pad.l + i * (barW + gap) + gap/2;
      var y = pad.t + ih - h;
      ctx.fillStyle = '#2563eb';
      ctx.fillRect(x, y, barW, h);
      ctx.fillStyle = '#64748b';
      ctx.font = '10px system-ui,sans-serif';
      ctx.save();
      ctx.translate(x + barW/2, pad.t + ih + 4);
      ctx.rotate(-Math.PI/4);
      var lab = String(labels[i]);
      if (lab.length > 6) lab = lab.slice(0,6);
      ctx.fillText(lab, 0, 0);
      ctx.restore();
    }
  }
  canvas.style.display = 'inline-block';
  $('dwPvChartDl').disabled = false;
  if (U.oplog) U.oplog.add('图表', kind + ' · ' + title);
}

$('dwPvChartBar').onclick = function(){ drawChart('bar'); };
$('dwPvChartPie').onclick = function(){ drawChart('pie'); };
$('dwPvChartDl').onclick = function(){
  var c = $('dwPvCanvas');
  if (!c) return;
  c.toBlob(function(b){ if (b) U.saveBlob(b, '图表.png'); });
};

/* 透视结果缓存，供图表使用（在原 dwPvRun 末尾也要写 PV） */
var _oldPvRun = $('dwPvRun').onclick;
if (_oldPvRun) {
  $('dwPvRun').onclick = function(){
    _oldPvRun.call(this);
    var g1 = +$('dwPvGroup').value || 0;
    var labels = [], values = [];
    var g2 = $('dwPvGroup2').value;
    // pvRows in outer scope if available via closure - read DOM instead
    var table = document.querySelector('#dwPvOut table tbody');
    if (table){
      Array.prototype.forEach.call(table.querySelectorAll('tr'), function(tr){
        var tds = tr.querySelectorAll('td');
        if (tds.length >= 2){
          labels.push(tds[0].textContent.trim());
          var last = tds[tds.length-2];
          var v = parseFloat(String(last.textContent).replace(/,/g,''));
          if (!isNaN(v)) values.push(v);
        }
      });
      PV = { labels: labels, values: values, title: '透视汇总 · ' + (DS.headers[g1]||'') };
    }
  };
}

/* ---------- 对外接口：供 js/data-batch.js（多表合并 / 按列拆表）复用 ---------- */
TB.datawork = {
  getDS: function(){ return DS; },
  setDataset: setDataset,
  parseAnyFile: parseAnyFile,
  exportRows: exportRows,
};

})();
