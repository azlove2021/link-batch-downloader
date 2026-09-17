/* ============ 发票信息提取（文本 / PDF 文字层） ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;
var IC = TB.invoiceCore || {};   /* 纯函数核心：js/invoice-core.js（重复检测 / 台账比对） */

var records = [];
var dupMap = {};                 /* 归一化号码 → [记录下标]，仅含重复组 */
var ledger = null, ledgerName = '';   /* 台账索引（IC.buildLedger 的结果） */
var ledgerFlags = [];            /* 与 records 对齐：true 在册 / false 没有 / null 无号码 */

/* ---------- 输入 ---------- */
$('invPasteBtn').onclick = async function(){
  try{
    var t = await navigator.clipboard.readText();
    if(!t){ notice('warn','剪贴板为空'); return; }
    $('invText').value = ($('invText').value ? $('invText').value + '\n\n====\n\n' : '') + t;
    notice('info','已粘贴');
  }catch(e){
    notice('warn','无法读剪贴板，请手动 Ctrl+V');
    $('invText').focus();
  }
};
$('invClear').onclick = function(){
  $('invText').value = '';
  records = [];
  dupMap = {};
  ledgerFlags = [];
  $('invTableWrap').innerHTML = '';
  $('invStat').textContent = '';
};
$('invDrop').onclick = function(){ $('invText').focus(); };

$('invDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('invDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('invDrop').addEventListener('drop', async function(e){
  e.preventDefault(); this.classList.remove('over');
  await ingestFiles(e.dataTransfer.files);
});
$('invTxtBtn').onclick = function(){ $('invTxt').click(); };
$('invTxt').onchange = async function(){ await ingestFiles(this.files); this.value=''; };
$('invPdfBtn').onclick = function(){ $('invPdf').click(); };
$('invPdf').onchange = async function(){ await ingestFiles(this.files); this.value=''; };

async function ingestFiles(fileList){
  if(!fileList || !fileList.length) return;
  var parts = [];
  for(var i=0;i<fileList.length;i++){
    var f = fileList[i];
    try{
      if(/\.pdf$/i.test(f.name) || f.type === 'application/pdf'){
        notice('info','正在从 PDF 提取文字：' + esc(f.name) + ' …');
        var t = await extractPdfText(f);
        if(t && t.trim()) parts.push('#### ' + f.name + '\n' + t);
        else parts.push('#### ' + f.name + '\n（未提取到文字层，若是扫描件请先 OCR 后粘贴文字）');
      }else if(/\.(txt|md|csv|log)$/i.test(f.name) || /^text\//.test(f.type)){
        parts.push('#### ' + f.name + '\n' + await f.text());
      }else if(/^image\//.test(f.type) || /\.(png|jpe?g|bmp|webp|tif|tiff)$/i.test(f.name)){
        notice('warn','图片发票请点右上「识别图片发票…（桌面）」——拖入的文件拿不到本机路径，无法调用系统 OCR：' + esc(f.name));
      }else{
        notice('warn','跳过不支持的文件：' + f.name);
      }
    }catch(e){
      notice('err','读取 ' + f.name + ' 失败：' + esc(e.message));
    }
  }
  if(parts.length){
    $('invText').value = ($('invText').value ? $('invText').value + '\n\n' : '') + parts.join('\n\n====\n\n');
    notice('info','已导入 ' + parts.length + ' 个文件的文字');
  }
}

/* ---------- PDF 文字层提取（纯前端尽力而为） ---------- */
async function extractPdfText(file){
  var buf = new Uint8Array(await file.arrayBuffer());
  var raw = latin1(buf);
  var streams = collectStreams(buf, raw);
  var cmapMap = {};
  var contentParts = [];

  for(var i=0;i<streams.length;i++){
    var s = streams[i];
    var data;
    if(/\/FlateDecode/.test(s.dict)){
      try{ data = await inflateAsync(s.rawData); }
      catch(e){ data = ''; }
    }else{
      data = latin1(s.rawData);
    }
    if(!data) continue;
    if(/beginbfchar|beginbfrange/i.test(data)){
      parseCMap(data, cmapMap);
    }
    if(/(?:Tj|TJ)/.test(data) && !/beginbfchar|beginbfrange/i.test(data)){
      contentParts.push(data);
    }
  }
  var text = contentParts.map(function(c){ return extractFromContent(c, cmapMap); }).join('\n');
  return text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function latin1(u8){
  var s = '';
  var CH = 0x8000;
  for(var i=0;i<u8.length;i+=CH){
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i+CH, u8.length)));
  }
  return s;
}

function collectStreams(buf, raw){
  var out = [];
  var re = /stream\r?\n?/g;
  var m;
  while((m = re.exec(raw)) !== null){
    var objStart = raw.lastIndexOf('obj', m.index);
    var dict = (objStart >= 0 && objStart < m.index) ? raw.slice(objStart, m.index) : '';
    var lenM = dict.match(/\/Length\s+(\d+)/);
    if(!lenM) continue;
    var len = parseInt(lenM[1], 10);
    if(len <= 0 || len > buf.length) continue;
    var dataStart = m.index + m[0].length;
    if(dataStart + len > buf.length) continue;
    out.push({ dict: dict, rawData: buf.subarray(dataStart, dataStart + len) });
    re.lastIndex = dataStart + len;
  }
  return out;
}

async function inflateAsync(u8){
  var ds = new DecompressionStream('deflate');
  var writer = ds.writable.getWriter();
  writer.write(u8); writer.close();
  var ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

function parseCMap(text, map){
  var bfchar = text.match(/beginbfchar([\s\S]*?)endbfchar/g);
  if(bfchar){
    bfchar.forEach(function(block){
      var re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, m;
      while((m = re.exec(block)) !== null){
        map[m[1].toLowerCase()] = hexToUnicode(m[2]);
      }
    });
  }
  var bfrange = text.match(/beginbfrange([\s\S]*?)endbfrange/g);
  if(bfrange){
    bfrange.forEach(function(block){
      var re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, m;
      while((m = re.exec(block)) !== null){
        var a = parseInt(m[1], 16), b = parseInt(m[2], 16);
        var base = hexToUnicode(m[3]);
        for(var c=a;c<=b && c-a<512;c++){
          if(base.length === 1) map[c.toString(16)] = String.fromCharCode(base.charCodeAt(0) + (c-a));
          else map[c.toString(16)] = base;
        }
      }
    });
  }
}
function hexToUnicode(hex){
  var out = '';
  for(var i=0;i+3<hex.length;i+=4){
    var h = hex.substr(i,4);
    if(h.length < 4) break;
    var cp = parseInt(h, 16);
    if(isNaN(cp)) break;
    out += String.fromCharCode(cp);
  }
  return out;
}

function extractFromContent(content, cmap){
  var out = [];
  var lines = content.split(/\r?\n/);
  lines.forEach(function(line){
    if(!/(Tj|TJ|')/.test(line)) return;
    var s = '';
    var re3 = /<([0-9A-Fa-f]+)>/g, mm;
    while((mm = re3.exec(line)) !== null){
      s += decodeHexRun(mm[1], cmap);
    }
    var re4 = /\(((?:\\.|[^\\)])*)\)/g;
    while((mm = re4.exec(line)) !== null){
      s += pdfLiteral(mm[1]);
    }
    if(s) out.push(s);
  });
  if(out.join('').replace(/\s/g,'').length < 4){
    out = [];
    var re5 = /<([0-9A-Fa-f]+)>/g, mm;
    while((mm = re5.exec(content)) !== null){
      out.push(decodeHexRun(mm[1], cmap));
    }
  }
  return out.join('\n');
}
function decodeHexRun(hex, cmap){
  var s = '';
  var useCMap = cmap && Object.keys(cmap).length;
  for(var i=0;i+3<hex.length;i+=4){
    var code = hex.substr(i,4).toLowerCase();
    if(useCMap && cmap[code] != null){ s += cmap[code]; continue; }
    var cp = parseInt(code, 16);
    if(!isNaN(cp) && cp >= 32) s += String.fromCharCode(cp);
  }
  if(!s){
    for(var i=0;i+1<hex.length;i+=2){
      var code = hex.substr(i,2).toLowerCase();
      if(useCMap && cmap[code] != null){ s += cmap[code]; continue; }
      var cp = parseInt(code, 16);
      if(!isNaN(cp) && cp >= 32) s += String.fromCharCode(cp);
    }
  }
  return s;
}
function pdfLiteral(s){
  return s.replace(/\\n/g,'\n').replace(/\\r/g,'').replace(/\\t/g,' ')
          .replace(/\\(\d{1,3})/g, function(_,o){ return String.fromCharCode(parseInt(o,8)); })
          .replace(/\\\\/g,'\\').replace(/\\([()])/g,'$1');
}

/* ---------- 字段解析 ---------- */
function splitInvoices(text){
  var blocks = text.split(/\n={3,}\n|\n{2,}(?=电子发票|增值税|普通发票|专用发票|全电发票|#)/);
  return blocks.map(function(b){ return b.trim(); }).filter(function(b){ return b.length > 20; });
}
function grab(text, patterns){
  for(var i=0;i<patterns.length;i++){
    var m = text.match(patterns[i]);
    if(m) return (m[1] || m[0] || '').trim();
  }
  return '';
}
function parseOne(text){
  var r = { raw: text };
  r.code = grab(text, [
    /发票代码[：:\s]*([0-9A-Za-z]{10,20})/,
    /代码[：:\s]*([0-9A-Za-z]{10,20})/
  ]);
  r.number = grab(text, [
    /发票号码[：:\s]*([0-9A-Za-z]{8,20})/,
    /号码[：:\s]*([0-9A-Za-z]{8,20})/
  ]);
  r.date = grab(text, [
    /开票日期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
    /开票日期[：:\s]*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,
    /日期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
    /(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/
  ]);
  if(r.date) r.date = r.date.replace(/\s+/g,'');
  r.checkTail = grab(text, [
    /校验码[：:\s]*(?:\S+\s+){4,6}(\d{6})\s*$/,
    /校验码[：:\s]*\S*?(\d{6})(?!\d)/
  ]);
  r.buyer = grab(text, [
    /购\s*买\s*方\s*名\s*称[：:\s]*([^\n]+)/,
    /购买方[：:\s]*([^\n]+)/
  ]);
  r.buyerTax = grab(text, [
    /购买方.{0,40}?纳税人识别号[：:\s]*([0-9A-Za-z]+)/,
    /购买方.{0,40}?税\s*号[：:\s]*([0-9A-Za-z]+)/,
    /购方.{0,20}?识别号[：:\s]*([0-9A-Za-z]+)/
  ]);
  r.seller = grab(text, [
    /销\s*售\s*方\s*名\s*称[：:\s]*([^\n]+)/,
    /销售方[：:\s]*([^\n]+)/
  ]);
  if(!r.seller){
    var ms = text.match(/名\s*称[：:\s]*([^\n]+)/g);
    if(ms && ms.length){
      var last = ms[ms.length-1].replace(/名\s*称[：:\s]*/,'').trim();
      if(!r.buyer || last !== r.buyer) r.seller = last;
    }
  }
  r.sellerTax = grab(text, [
    /销售方.{0,40}?纳税人识别号[：:\s]*([0-9A-Za-z]+)/,
    /销售方.{0,40}?税\s*号[：:\s]*([0-9A-Za-z]+)/,
    /销方.{0,20}?识别号[：:\s]*([0-9A-Za-z]+)/
  ]);
  r.amount = grab(text, [
    /合\s*计[^\n]*?¥?\s*([0-9,]+\.\d{2})/,
    /金\s*额\s*合计[^\n]*?([0-9,]+\.\d{2})/
  ]);
  r.tax = grab(text, [
    /税\s*额[^\n]*?¥?\s*([0-9,]+\.\d{2})/,
    /税额合计[：:\s]*([0-9,]+\.\d{2})/
  ]);
  r.total = grab(text, [
    /价税合计[^\n]*?¥?\s*([0-9,]+\.\d{2})/,
    /价税合计[^\n]*?([0-9,]+\.\d{2})/,
    /小写[：:\s]*¥?\s*([0-9,]+\.\d{2})/,
    /¥\s*([0-9,]+\.\d{2})/
  ]);
  r.totalCN = grab(text, [
    /价税合计[（(]大写[）)][^\n]*?([壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]{2,})/
  ]);
  r.isFull = /全电|电子发票/.test(text) || (!r.code && r.number);
  r.title = grab(text, [/电子发票|增值税.{0,10}发票|全电发票/]) || '发票';
  ['buyer','seller'].forEach(function(k){
    if(r[k]){
      r[k] = r[k].split(/纳税人|统一社会信用|信用代码|开户/)[0].trim();
      if(r[k].length > 80) r[k] = r[k].slice(0,80);
    }
  });
  return r;
}

$('invParse').onclick = function(){
  var text = $('invText').value;
  if(!text.trim()){ notice('warn','请先粘贴或导入发票文字'); return; }
  var blocks = splitInvoices(text);
  if(!blocks.length) blocks = [text];
  records = blocks.map(parseOne);
  refreshFlags();
  renderTable();
  updateStat();
  var dupGroups = Object.keys(dupMap).length;
  var ok = records.filter(function(r){ return r.number || r.total; }).length;
  notice(dupGroups ? 'warn' : (ok ? 'info' : 'warn'),
    dupGroups ? ('解析完成：发现 ' + dupGroups + ' 组重复发票号，已标红（防重复报销）')
              : ('解析完成：共 ' + records.length + ' 条'));
};

function refreshFlags(){
  dupMap = IC.findDuplicates ? IC.findDuplicates(records) : {};
  ledgerFlags = (ledger && IC.matchLedger) ? IC.matchLedger(ledger, records)
                                           : records.map(function(){ return null; });
}

function updateStat(){
  var ok = records.filter(function(r){ return r.number || r.total; }).length;
  var stat = '解析 ' + records.length + ' 张，识别到关键字段 ' + ok + ' 张';
  var dupGroups = Object.keys(dupMap).length;
  if(dupGroups){
    var dupCount = 0;
    Object.keys(dupMap).forEach(function(k){ dupCount += dupMap[k].length; });
    stat += '；⚠ ' + dupGroups + ' 组重复号码（共 ' + dupCount + ' 张）';
  }
  if(ledger){
    var has = 0, miss = 0;
    ledgerFlags.forEach(function(f){ if(f === true) has++; else if(f === false) miss++; });
    stat += '；台账（' + ledgerName + '）：' + has + ' 在册 / ' + miss + ' 未找到';
  }
  $('invStat').textContent = stat;
}

function isDup(r){
  var n = IC.normNumber ? IC.normNumber(r.number) : '';
  return !!(n && dupMap[n] && dupMap[n].length >= 2);
}

var COLS = [
  ['number','发票号码'],
  ['date','开票日期'],
  ['total','价税合计'],
  ['amount','金额'],
  ['tax','税额'],
  ['buyer','购买方'],
  ['buyerTax','购方税号'],
  ['seller','销售方'],
  ['sellerTax','销方税号'],
  ['code','发票代码'],
  ['checkTail','校验码后6位'],
  ['totalCN','合计大写']
];

function renderTable(){
  var wrap = $('invTableWrap');
  if(!records.length){ wrap.innerHTML=''; return; }
  var onlyMissing = ledger && $('invOnlyMissing').checked;
  var h = '<div class="rtable"><table><thead><tr><th>#</th>';
  COLS.forEach(function(c){ h += '<th>'+c[1]+'</th>'; });
  if(ledger) h += '<th>台账</th>';
  h += '</tr></thead><tbody>';
  records.forEach(function(r, i){
    if(onlyMissing && ledgerFlags[i] !== false) return;
    var dup = isDup(r);
    h += '<tr' + (dup ? ' style="background:#fff1f0"' : '') + '><td>'+(i+1)+'</td>';
    COLS.forEach(function(c){
      var v = esc(r[c[0]] || '');
      if(c[0] === 'number' && dup) v = '<b style="color:#c0392b">⚠ ' + v + '</b>';
      h += '<td>' + v + '</td>';
    });
    if(ledger){
      var f = ledgerFlags[i];
      h += '<td>' + (f === true ? '✓ 在册'
            : f === false ? '<b style="color:#c0392b">✗ 台账没有</b>'
            : '<span class="muted">无号码</span>') + '</td>';
    }
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  wrap.innerHTML = h;
}

$('invOnlyMissing').addEventListener('change', renderTable);

/* ---------- 图片发票批量 OCR（桌面版 · Windows 系统 OCR，全程离线） ----------
 * 后端 ocr_image：先系统 OCR（零依赖），失败再尝试本机 Tesseract。
 * 注意：拖拽进来的 File 拿不到本机路径，所以这里走系统文件对话框选择。 */
$('invOcrBtn').onclick = async function(){
  var D = TB.desktop;
  if(!D || !D.isDesktop()){
    notice('err','图片 OCR 需桌面版；网页版请先用其它工具识别文字后粘贴');
    return;
  }
  var files = null;
  try{ files = await D.pickFiles(['png','jpg','jpeg','bmp','webp','tif','tiff']); }
  catch(e){ notice('err','选择失败：'+esc(String(e.message||e))); return; }
  if(!files || !files.length) return;
  var btn = this; btn.disabled = true;
  var env = D.env ? D.env() : null;
  var parts = [], failed = [];
  for(var i=0;i<files.length;i++){
    btn.textContent = '识别中 ' + (i+1) + '/' + files.length + ' …';
    try{
      var text = await D.invoke('ocr_image', { path: files[i].path, tesseract: (env && env.tesseract) || null });
      parts.push('#### ' + files[i].name + '\n' + ((text && text.trim()) ? text.trim() : '（未识别到文字）'));
    }catch(e){
      failed.push(files[i].name + '：' + String(e.message || e).slice(0,60));
    }
  }
  btn.disabled = false; btn.textContent = '识别图片发票…（桌面）';
  if(parts.length){
    $('invText').value = ($('invText').value ? $('invText').value + '\n\n====\n\n' : '') + parts.join('\n\n====\n\n');
    $('invParse').click();   // OCR 完自动解析，少点一步
  }
  if(failed.length){
    notice('warn','OCR 完成 ' + parts.length + ' 张，失败 ' + failed.length + ' 张（' + esc(failed[0]) + (failed.length>1?' 等':'') + '）');
  }else if(parts.length){
    notice('info','OCR 完成并已解析 ' + parts.length + ' 张（全程离线）');
  }
};

/* ---------- 台账比对：载入公司台账 xlsx/csv，按发票号码找「台账里没有的票」 ---------- */
$('invLedgerBtn').onclick = function(){ $('invLedger').click(); };
$('invLedger').onchange = async function(){
  var f = this.files && this.files[0];
  this.value = '';
  if(!f) return;
  if(!records.length){ notice('warn','请先解析发票，再载入台账比对'); return; }
  try{
    var rows;
    if(/\.(xlsx|xls)$/i.test(f.name)){
      if(!window.XLSX) throw new Error('Excel 组件未加载');
      var wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), {type:'array'});
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, raw:false, defval:''});
    }else{
      rows = U.parseCsv(await f.text());
    }
    ledger = IC.buildLedger(rows);
    ledgerName = f.name;
    refreshFlags();
    renderTable();
    updateStat();
    var miss = ledgerFlags.filter(function(x){ return x === false; }).length;
    notice(miss ? 'warn' : 'info',
      '台账已载入（' + esc(ledgerName) + '）：' + miss + ' 张发票台账里没有' + (miss ? '，已标出' : ''));
  }catch(e){
    notice('err','台账读取失败：'+esc(String(e.message||e)));
  }
};

/* ---------- 导出（自动带上重复检测 / 台账比对列） ---------- */
function exportHeaders(){
  var hs = COLS.map(function(c){ return c[1]; });
  if(Object.keys(dupMap).length) hs.push('重复检测');
  if(ledger) hs.push('台账比对');
  return hs;
}
function exportRow(r, i){
  var row = COLS.map(function(c){ return r[c[0]] || ''; });
  if(Object.keys(dupMap).length) row.push(isDup(r) ? '重复' : '');
  if(ledger) row.push(ledgerFlags[i] === true ? '在册' : ledgerFlags[i] === false ? '台账没有' : '无号码');
  return row;
}

$('invCsv').onclick = function(){
  if(!records.length){ notice('warn','请先解析'); return; }
  var rows = [exportHeaders()];
  records.forEach(function(r, i){ rows.push(exportRow(r, i)); });
  U.saveBlob(new Blob(['﻿' + U.toCsv(rows, ',')], {type:'text/csv;charset=utf-8'}), '发票信息.csv');
  notice('info','已导出 CSV');
};
$('invXlsx').onclick = async function(){
  if(!records.length){ notice('warn','请先解析'); return; }
  try{
    var rows = records.map(function(r, i){ return exportRow(r, i); });
    var blob = await U.makeXlsx(exportHeaders(), rows, '发票');
    U.saveBlob(blob, '发票信息.xlsx');
    notice('info','已导出 Excel');
  }catch(e){ notice('err','导出失败：'+esc(e.message)); }
};
})();
