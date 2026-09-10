/* ============ 发票信息提取（文本 / PDF 文字层） ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

var records = [];

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
  renderTable();
  var ok = records.filter(function(r){ return r.number || r.total; }).length;
  $('invStat').textContent = '解析 ' + records.length + ' 张，识别到关键字段 ' + ok + ' 张';
  notice(ok ? 'info' : 'warn', '解析完成：共 ' + records.length + ' 条');
};

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
  var h = '<div class="rtable"><table><thead><tr><th>#</th>';
  COLS.forEach(function(c){ h += '<th>'+c[1]+'</th>'; });
  h += '</tr></thead><tbody>';
  records.forEach(function(r, i){
    h += '<tr><td>'+(i+1)+'</td>';
    COLS.forEach(function(c){
      h += '<td>' + esc(r[c[0]] || '') + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  wrap.innerHTML = h;
}

$('invCsv').onclick = function(){
  if(!records.length){ notice('warn','请先解析'); return; }
  var rows = [COLS.map(function(c){ return c[1]; })];
  records.forEach(function(r){
    rows.push(COLS.map(function(c){ return r[c[0]] || ''; }));
  });
  U.saveBlob(new Blob(['﻿' + U.toCsv(rows, ',')], {type:'text/csv;charset=utf-8'}), '发票信息.csv');
  notice('info','已导出 CSV');
};
$('invXlsx').onclick = async function(){
  if(!records.length){ notice('warn','请先解析'); return; }
  try{
    var rows = records.map(function(r){
      return COLS.map(function(c){ return r[c[0]] || ''; });
    });
    var blob = await U.makeXlsx(COLS.map(function(c){ return c[1]; }), rows, '发票');
    U.saveBlob(blob, '发票信息.xlsx');
    notice('info','已导出 Excel');
  }catch(e){ notice('err','导出失败：'+esc(e.message)); }
};
})();
