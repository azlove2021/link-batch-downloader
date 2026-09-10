/* ============ PDF 工具箱（pdf-lib） ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

if (typeof window.PDFLib === 'undefined') {
  notice('err','pdf-lib 未加载，PDF 工具不可用。请确认 js/vendor/pdf-lib.min.js 存在。');
  return;
}

var PDFLib = window.PDFLib;
var files = []; // {name, bytes:Uint8Array, id}
var mode = 'merge';
var nextId = 1;

function setMode(m){
  mode = m;
  document.querySelectorAll('#pdfModeBtns button').forEach(function(b){
    b.classList.toggle('pri', b.getAttribute('data-m') === m);
  });
  // 显隐选项区
  var show = {
    split: true,
    rotate: true,
    pagenum: true,
    extract: true,
    merge: false,
    info: false
  };
  $('pdfOpts').style.display = show[m] ? '' : 'none';
  $('pdfSplitStyleRow').style.display = m === 'split' ? '' : 'none';
  $('pdfRotateRow').style.display = m === 'rotate' ? '' : 'none';
  $('pdfPagenumRow').style.display = m === 'pagenum' ? '' : 'none';
  $('pdfExtractRow').style.display = m === 'extract' ? '' : 'none';
  if (m === 'split'){
    var style = $('pdfSplitStyle').value;
    $('pdfSplitPagesRow').style.display = style === 'pages' ? '' : 'none';
    $('pdfSplitEveryRow').style.display = style === 'every' ? '' : 'none';
  }
  renderHints();
  renderList();
}

document.querySelectorAll('#pdfModeBtns button').forEach(function(b){
  b.onclick = function(){ setMode(b.getAttribute('data-m')); };
});

function renderHints(){
  var h = {
    merge: '按列表顺序合并。可上下移动调整顺序，然后「生成 PDF」。',
    split: '从第几页开始拆成两个文件？也可按「每 N 页」拆成多个。',
    rotate: '给所有页（或指定范围）旋转 90 / 180 / 270 度。',
    pagenum: '在每页底部/顶部写入页码，可自定义格式与字号。',
    extract: '导出指定页（1,3,5-8 这种写法）。',
    info: '查看页数、元数据等基本信息。'
  }[mode] || '';
  var el = document.getElementById('pdfHint');
  if (el) el.textContent = h;
}

$('pdfPick').onclick = function(){ $('pdfFiles').click(); };
$('pdfFiles').onchange = function(){
  addFiles(this.files);
  this.value = '';
};
var drop = $('pdfDrop');
drop.onclick = function(e){
  if (e.target.tagName === 'BUTTON') return;
  $('pdfFiles').click();
};
drop.addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
drop.addEventListener('dragleave', function(){ this.classList.remove('over'); });
drop.addEventListener('drop', async function(e){
  e.preventDefault(); this.classList.remove('over');
  await addFiles(e.dataTransfer.files);
});

async function addFiles(fileList){
  var arr = Array.from(fileList || []).filter(function(f){
    return /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  });
  if (!arr.length){ notice('warn','请添加 PDF 文件'); return; }
  for (var i=0;i<arr.length;i++){
    var buf = new Uint8Array(await arr[i].arrayBuffer());
    files.push({ id: nextId++, name: arr[i].name, bytes: buf });
  }
  renderList();
  notice('info','已加入 ' + arr.length + ' 个 PDF（共 ' + files.length + '）');
}

function renderList(){
  var box = $('pdfList');
  if (!files.length){
    box.innerHTML = '<div class="muted" style="padding:10px 0">尚未添加 PDF</div>';
    $('pdfRun').disabled = true;
    return;
  }
  $('pdfRun').disabled = false;
  var h = '<div class="rtable"><table><thead><tr><th>#</th><th>文件名</th><th>大小</th><th>页数</th><th>操作</th></tr></thead><tbody>';
  files.forEach(function(f, i){
    h += '<tr data-id="'+f.id+'">' +
      '<td>'+(i+1)+'</td>' +
      '<td class="mono">'+esc(f.name)+'</td>' +
      '<td>'+U.fmtSize(f.bytes.length)+'</td>' +
      '<td class="pdf-pages" data-id="'+f.id+'">…</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="sm" data-up="'+f.id+'" title="上移">↑</button> ' +
        '<button class="sm" data-down="'+f.id+'" title="下移">↓</button> ' +
        '<button class="sm dan" data-del="'+f.id+'" title="移除">✕</button>' +
      '</td></tr>';
  });
  h += '</tbody></table></div>';
  box.innerHTML = h;
  box.querySelectorAll('[data-up]').forEach(function(b){
    b.onclick = function(){ move(+b.getAttribute('data-up'), -1); };
  });
  box.querySelectorAll('[data-down]').forEach(function(b){
    b.onclick = function(){ move(+b.getAttribute('data-down'), 1); };
  });
  box.querySelectorAll('[data-del]').forEach(function(b){
    b.onclick = function(){
      var id = +b.getAttribute('data-del');
      files = files.filter(function(f){ return f.id !== id; });
      renderList();
    };
  });
  // async page counts
  files.forEach(async function(f){
    try{
      var doc = await PDFLib.PDFDocument.load(f.bytes, { ignoreEncryption: true });
      var n = doc.getPageCount();
      var el = box.querySelector('.pdf-pages[data-id="'+f.id+'"]');
      if (el) el.textContent = n;
    }catch(e){
      var el = box.querySelector('.pdf-pages[data-id="'+f.id+'"]');
      if (el){ el.textContent = '错误'; el.style.color = 'var(--err)'; }
    }
  });
}

function move(id, dir){
  var i = files.findIndex(function(f){ return f.id === id; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= files.length) return;
  var t = files[i]; files[i] = files[j]; files[j] = t;
  renderList();
}

$('pdfClear').onclick = function(){
  files = [];
  renderList();
  $('pdfOut').innerHTML = '';
};

function parsePageSpec(spec, pageCount){
  // "1,3,5-8" → indices 0-based
  var set = Object.create(null);
  String(spec||'').split(/[,，]/).forEach(function(part){
    part = part.trim();
    if (!part) return;
    var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m){
      var a = +m[1], b = +m[2];
      if (a > b){ var tmp=a; a=b; b=tmp; }
      for (var p=a;p<=b;p++) if (p>=1 && p<=pageCount) set[p-1]=1;
    } else {
      var n = +part;
      if (n>=1 && n<=pageCount) set[n-1]=1;
    }
  });
  return Object.keys(set).map(Number).sort(function(a,b){ return a-b; });
}

async function concatPdfBytes(list){
  var out = await PDFLib.PDFDocument.create();
  for (var i=0;i<list.length;i++){
    var src = await PDFLib.PDFDocument.load(list[i], { ignoreEncryption: true });
    var pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(function(p){ out.addPage(p); });
  }
  return out;
}

function saveOut(doc, name){
  return doc.save().then(function(bytes){
    U.saveBlob(new Blob([bytes], {type:'application/pdf'}), name || 'output.pdf');
    var box = $('pdfOut');
    box.classList.remove('empty');
    box.textContent = '已生成：' + (name||'output.pdf') + '（' + U.fmtSize(bytes.length) + '）· 已触发下载';
  });
}

$('pdfRun').onclick = async function(){
  if (!files.length){ notice('warn','请先添加 PDF'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '处理中…';
  try{
    if (mode === 'merge'){
      if (files.length < 2) notice('info','只有一个文件，直接复制导出');
      var doc = await concatPdfBytes(files.map(function(f){ return f.bytes; }));
      await saveOut(doc, '合并结果.pdf');
      notice('info','合并完成：' + doc.getPageCount() + ' 页');
    }
    else if (mode === 'split'){
      if (!files[0]){ notice('warn','请添加至少 1 个 PDF'); return; }
      var src = await PDFLib.PDFDocument.load(files[0].bytes, { ignoreEncryption:true });
      var total = src.getPageCount();
      var style = $('pdfSplitStyle').value; // pages | every
      if (style === 'pages'){
        var cut = Math.max(1, Math.min(total, parseInt($('pdfSplitAt').value,10)||1));
        var a = await PDFLib.PDFDocument.create();
        var b = await PDFLib.PDFDocument.create();
        var pa = await a.copyPages(src, Array.from({length:cut}, function(_,i){ return i; }));
        pa.forEach(function(p){ a.addPage(p); });
        var pb = await b.copyPages(src, Array.from({length:total-cut}, function(_,i){ return cut+i; }));
        pb.forEach(function(p){ b.addPage(p); });
        await saveOut(a, 'part1_' + cut + '页.pdf');
        await saveOut(b, 'part2_' + (total-cut) + '页.pdf');
        notice('info','已拆分：前 ' + cut + ' 页 / 后 ' + (total-cut) + ' 页');
      } else {
        var n = Math.max(1, parseInt($('pdfSplitEvery').value,10)||1);
        var part = 0;
        for (var s=0; s<total; s+=n){
          part++;
          var d = await PDFLib.PDFDocument.create();
          var end = Math.min(total, s+n);
          var idx = [];
          for (var i=s;i<end;i++) idx.push(i);
          var pages = await d.copyPages(src, idx);
          pages.forEach(function(p){ d.addPage(p); });
          await saveOut(d, 'part' + part + '.pdf');
        }
        notice('info','已拆成 ' + part + ' 个文件（每个 ' + n + ' 页）');
      }
    }
    else if (mode === 'rotate'){
      if (!files[0]){ notice('warn','请添加至少 1 个 PDF'); return; }
      var deg = parseInt($('pdfRotate').value, 10) || 90;
      var doc = await PDFLib.PDFDocument.load(files[0].bytes, { ignoreEncryption:true });
      var range = $('pdfRotateRange').value.trim();
      var pages = range ? parsePageSpec(range, doc.getPageCount()) : doc.getPageIndices();
      pages.forEach(function(i){
        var p = doc.getPage(i);
        p.setRotation(PDFLib.degrees((p.getRotation().angle + deg) % 360));
      });
      await saveOut(doc, '旋转_' + deg + '度.pdf');
      notice('info','已旋转 ' + pages.length + ' 页 × ' + deg + '°');
    }
    else if (mode === 'pagenum'){
      if (!files[0]){ notice('warn','请添加至少 1 个 PDF'); return; }
      var doc = await PDFLib.PDFDocument.load(files[0].bytes, { ignoreEncryption:true });
      var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      var pos = $('pdfNumPos').value; // bottom | top
      var size = parseFloat($('pdfNumSize').value) || 12;
      var start = parseInt($('pdfNumStart').value, 10) || 1;
      var tmpl = $('pdfNumTpl').value || '{n} / {total}';
      var total = doc.getPageCount();
      doc.getPages().forEach(function(p, i){
        var { width, height } = p.getSize();
        var label = tmpl.replace('{n}', String(start+i)).replace('{total}', String(total));
        var tw = font.widthOfTextAtSize(label, size);
        var x = (width - tw) / 2;
        var y = pos === 'top' ? height - size - 12 : 18;
        p.drawText(label, { x:x, y:y, size:size, font:font, color: PDFLib.rgb(0.25,0.25,0.25) });
      });
      await saveOut(doc, '加页码.pdf');
      notice('info','已为 ' + total + ' 页写入页码');
    }
    else if (mode === 'extract'){
      if (!files[0]){ notice('warn','请添加至少 1 个 PDF'); return; }
      var src = await PDFLib.PDFDocument.load(files[0].bytes, { ignoreEncryption:true });
      var spec = $('pdfExtract').value.trim();
      if (!spec){ notice('warn','请填写页码范围，如 1,3,5-8'); return; }
      var idx = parsePageSpec(spec, src.getPageCount());
      if (!idx.length){ notice('warn','没有有效页码'); return; }
      var doc = await PDFLib.PDFDocument.create();
      var pages = await doc.copyPages(src, idx);
      pages.forEach(function(p){ doc.addPage(p); });
      await saveOut(doc, '提取_' + idx.length + '页.pdf');
      notice('info','已提取 ' + idx.length + ' 页');
    }
    else if (mode === 'info'){
      if (!files[0]){ notice('warn','请添加至少 1 个 PDF'); return; }
      var lines = [];
      for (var i=0;i<files.length;i++){
        try{
          var d = await PDFLib.PDFDocument.load(files[i].bytes, { ignoreEncryption:true });
          var meta = d.getMetadata ? d.getMetadata() : null;
          var info = (meta && meta.info) || {};
          lines.push(
            '【' + files[i].name + '】\n' +
            '  页数：' + d.getPageCount() + '\n' +
            '  标题：' + (info.Title || '—') + '\n' +
            '  作者：' + (info.Author || '—') + '\n' +
            '  创建：' + (info.CreationDate || '—') + '\n' +
            '  大小：' + U.fmtSize(files[i].bytes.length)
          );
        }catch(e){
          lines.push('【' + files[i].name + '】读取失败：' + e.message);
        }
      }
      $('pdfOut').classList.remove('empty');
      $('pdfOut').textContent = lines.join('\n\n');
    }
  }catch(e){
    notice('err','PDF 处理失败：' + esc(e.message));
    console.error(e);
  }finally{
    btn.disabled = files.length === 0;
    btn.textContent = '生成 PDF';
  }
};

// split style toggle
$('pdfSplitStyle').onchange = function(){
  $('pdfSplitPagesRow').style.display = this.value === 'pages' ? '' : 'none';
  $('pdfSplitEveryRow').style.display = this.value === 'every' ? '' : 'none';
};

setMode('merge');
})();
