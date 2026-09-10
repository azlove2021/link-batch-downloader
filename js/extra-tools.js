/* ============ PDF 加密 / 解密 / 哈希对比 / 颜色 / SQL ============ */
'use strict';

/* ---------- PDF 加密解密 ---------- */
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;
if (typeof window.PDFLib === 'undefined') return;
var PDFLib = window.PDFLib;
var buf = null, fname = '';

$('pdfCryptPick').onclick = function(){ $('pdfCryptFiles').click(); };
$('pdfCryptFiles').onchange = async function(){
  var f = this.files && this.files[0];
  if (!f) return;
  fname = f.name;
  buf = new Uint8Array(await f.arrayBuffer());
  $('pdfCryptInfo').textContent = f.name + ' · ' + U.fmtSize(buf.length);
  this.value = '';
};

$('pdfCryptRun').onclick = async function(){
  if (!buf){ notice('warn','请先选择 PDF'); return; }
  var mode = $('pdfCryptMode').value;
  var pass = $('pdfCryptPass').value;
  if (!pass){ notice('warn','请输入密码'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '处理中…';
  try{
    if (mode === 'encrypt'){
      var doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
      var out = await doc.save({
        userPassword: pass,
        ownerPassword: pass + '_owner',
        permissions: {
          printing: 'highResPrint',
          modifying: false,
          copying: false,
          annotating: true,
          fillingForms: true,
          contentAccessibility: true,
          documentAssembly: true
        }
      });
      U.saveBlob(new Blob([out], {type:'application/pdf'}), fname.replace(/\.pdf$/i,'') + '_加密.pdf');
      notice('info','已加密并下载');
      $('pdfCryptMsg').textContent = '输出 ' + U.fmtSize(out.length) + ' · 已用用户密码保护';
    } else {
      var doc2 = await PDFLib.PDFDocument.load(buf, { userPassword: pass, ignoreEncryption: true });
      var out2 = await doc2.save();
      U.saveBlob(new Blob([out2], {type:'application/pdf'}), fname.replace(/\.pdf$/i,'') + '_解密.pdf');
      notice('info','已解密并下载');
      $('pdfCryptMsg').textContent = '输出 ' + U.fmtSize(out2.length) + ' · 页数 ' + doc2.getPageCount();
    }
  }catch(e){
    notice('err', mode === 'encrypt' ? ('加密失败：' + esc(e.message)) : ('解密失败：密码错误或文件损坏'));
    $('pdfCryptMsg').textContent = e.message || '';
  }finally{
    btn.disabled = false; btn.textContent = '处理 PDF';
  }
};
})();

/* ---------- 哈希对比 ---------- */
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

var fileA = null, fileB = null;
async function setFile(which, file){
  if (which === 'A'){ fileA = file; $('hcA').textContent = file ? (file.name + ' · ' + U.fmtSize(file.size)) : '未选择'; }
  else { fileB = file; $('hcB').textContent = file ? (file.name + ' · ' + U.fmtSize(file.size)) : '未选择'; }
}
$('hcPickA').onclick = function(){ $('hcFileA').click(); };
$('hcPickB').onclick = function(){ $('hcFileB').click(); };
$('hcFileA').onchange = function(){ setFile('A', this.files[0]); this.value=''; };
$('hcFileB').onchange = function(){ setFile('B', this.files[0]); this.value=''; };
$('hcMode').onchange = function(){
  var textMode = this.value === 'text';
  $('hcTextMode').style.display = textMode ? '' : 'none';
  $('hcFileMode').style.display = textMode ? 'none' : '';
};
$('hcMode').dispatchEvent(new Event('change'));

$('hcRun').onclick = async function(){
  try{
    var mode = $('hcMode').value;
    if (mode === 'text'){
      var a = $('hcTextA').value.trim().toLowerCase();
      var b = $('hcTextB').value.trim().toLowerCase();
      if (!a || !b){ notice('warn','请填写两段哈希'); return; }
      var same = a === b;
      $('hcOut').innerHTML =
        '<div style="font-size:16px;font-weight:650;color:' + (same?'var(--ok)':'var(--err)') + '">' +
        (same ? '✓ 完全一致' : '✗ 不一致') + '</div>' +
        '<div class="muted" style="margin-top:8px">A: ' + esc(a.slice(0,64)) + (a.length>64?'…':'') + '</div>' +
        '<div class="muted">B: ' + esc(b.slice(0,64)) + (b.length>64?'…':'') + '</div>' +
        (same ? '' : '<div class="muted" style="margin-top:8px">长度 ' + a.length + ' vs ' + b.length + '</div>');
      return;
    }
    if (!fileA || !fileB){ notice('warn','请选择两个文件'); return; }
    $('hcOut').textContent = '计算中…';
    var ha = await U.sha256Of(fileA);
    var hb = await U.sha256Of(fileB);
    var same = ha === hb;
    $('hcOut').innerHTML =
      '<div style="font-size:16px;font-weight:650;color:' + (same?'var(--ok)':'var(--err)') + '">' +
      (same ? '✓ 文件内容一致（SHA-256 相同）' : '✗ 文件内容不同') + '</div>' +
      '<div class="mono" style="margin-top:10px;word-break:break-all">A: ' + esc(ha) + '</div>' +
      '<div class="mono" style="word-break:break-all">B: ' + esc(hb) + '</div>';
  }catch(e){
    notice('err','对比失败：' + (e.message||e));
  }
};
$('hcClear').onclick = function(){
  fileA = fileB = null;
  $('hcA').textContent = '未选择'; $('hcB').textContent = '未选择';
  $('hcTextA').value = ''; $('hcTextB').value = '';
  $('hcOut').textContent = '结果';
};
})();

/* ---------- 颜色工具 ---------- */
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

function parseColor(input){
  var s = String(input||'').trim();
  if (!s) return null;
  if (s[0] === '#'){
    var h = s.slice(1);
    if (h.length === 3) h = h.split('').map(function(c){ return c+c; }).join('');
    if (h.length !== 6) return null;
    var r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    if ([r,g,b].some(function(x){ return isNaN(x); })) return null;
    return { r:r, g:g, b:b };
  }
  var m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { r:+m[1], g:+m[2], b:+m[3] };
  return null;
}
function toHex(c){
  return '#' + [c.r,c.g,c.b].map(function(x){ return ('0'+x.toString(16)).slice(-2); }).join('');
}
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  var max=Math.max(r,g,b), min=Math.min(r,g,b);
  var h,s,l=(max+min)/2;
  if(max===min){h=s=0;}
  else{
    var d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){
      case r: h=(g-b)/d+(g<b?6:0); break;
      case g: h=(b-r)/d+2; break;
      default: h=(r-g)/d+4;
    }
    h/=6;
  }
  return { h: Math.round(h*360), s: Math.round(s*100), l: Math.round(l*100) };
}

function updateColor(){
  var c = parseColor($('colorIn').value);
  if (!c){ $('colorOut').textContent = '无法解析颜色'; return; }
  var hex = toHex(c);
  var hsl = rgbToHsl(c.r,c.g,c.b);
  $('colorSwatch').style.background = hex;
  $('colorOut').textContent =
    'HEX   ' + hex.toUpperCase() + '\n' +
    'RGB   ' + c.r + ', ' + c.g + ', ' + c.b + '\n' +
    'HSL   ' + hsl.h + '°, ' + hsl.s + '%, ' + hsl.l + '%\n' +
    'CSS   rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
  $('colorCopy').dataset.val = hex;
}
$('colorIn').addEventListener('input', updateColor);
$('colorPick').oninput = function(){ $('colorIn').value = this.value; updateColor(); };
$('colorCopy').onclick = function(){ U.copyText(this.dataset.val || $('colorIn').value); };
updateColor();

// 色板提取
var paletteImg = null;
$('palPick').onclick = function(){ $('palFile').click(); };
$('palFile').onchange = function(){
  var f = this.files[0]; this.value='';
  if (!f) return;
  if (paletteImg && paletteImg.src) URL.revokeObjectURL(paletteImg.src);
  var url = URL.createObjectURL(f);
  paletteImg = new Image();
  paletteImg.onload = function(){ $('palInfo').textContent = f.name + ' · ' + paletteImg.naturalWidth + '×' + paletteImg.naturalHeight; extractPal(); };
  paletteImg.src = url;
};
$('palDrop').onclick = function(e){ if(e.target.tagName!=='BUTTON') $('palFile').click(); };
$('palDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('palDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('palDrop').addEventListener('drop', function(e){
  e.preventDefault(); this.classList.remove('over');
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f || !/^image\//.test(f.type)) return;
  var dt = new DataTransfer(); dt.items.add(f);
  $('palFile').files = dt.files;
  $('palFile').onchange();
});

function extractPal(){
  if (!paletteImg) return;
  var n = parseInt($('palCount').value, 10) || 6;
  var c = document.createElement('canvas');
  var scale = Math.min(1, 160 / Math.max(paletteImg.naturalWidth, paletteImg.naturalHeight));
  c.width = Math.max(1, Math.round(paletteImg.naturalWidth * scale));
  c.height = Math.max(1, Math.round(paletteImg.naturalHeight * scale));
  var ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(paletteImg, 0, 0, c.width, c.height);
  var data = ctx.getImageData(0,0,c.width,c.height).data;
  // 简易量化
  var buckets = Object.create(null);
  for (var i=0;i<data.length;i+=16){
    var r = data[i]>>4<<4, g = data[i+1]>>4<<4, b = data[i+2]>>4<<4;
    var key = r+','+g+','+b;
    if (!buckets[key]) buckets[key] = { r:r,g:g,b:b,n:0 };
    buckets[key].n++;
  }
  var list = Object.keys(buckets).map(function(k){ return buckets[k]; });
  list.sort(function(a,b){ return b.n - a.n; });
  list = list.slice(0, n);
  var box = $('palOut');
  box.innerHTML = '';
  list.forEach(function(c0){
    var hex = toHex(c0);
    var d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;cursor:pointer';
    d.innerHTML = '<span style="width:36px;height:36px;border-radius:8px;background:'+hex+';border:1px solid rgba(0,0,0,.08)"></span>' +
      '<span class="mono">'+hex.toUpperCase()+'</span>' +
      '<span class="muted">'+c0.n+' 采样</span>';
    d.onclick = function(){ U.copyText(hex); };
    box.appendChild(d);
  });
  if (!list.length) box.innerHTML = '<div class="muted">未能提取颜色</div>';
}
$('palCount').addEventListener('change', extractPal);
})();

/* ---------- SQL 格式化 ---------- */
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

var KEYWORDS = ('select|from|where|and|or|not|in|is|null|like|between|join|inner|left|right|full|outer|on|group|by|order|having|limit|offset|insert|into|values|update|set|delete|create|table|view|index|drop|alter|add|column|primary|key|foreign|references|unique|default|as|distinct|union|all|case|when|then|else|end|exists|desc|asc|with|recursive|into|export|using|filter|over|partition|cast|interval|true|false').split('|');

function formatSql(sql){
  var s = String(sql||'').replace(/\s+/g,' ').trim();
  if (!s) return '';
  // 关键词大写 + 换行
  var re = new RegExp('\\b(' + KEYWORDS.join('|') + ')\\b', 'gi');
  s = s.replace(re, function(m){
    var u = m.toUpperCase();
    // 子句前换行
    if (/^(SELECT|FROM|WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|INSERT|UPDATE|DELETE|VALUES|SET|UNION|LEFT|RIGHT|INNER|FULL|JOIN|ON|WITH|CREATE|DROP|ALTER)\b/.test(u)){
      return '\n' + u;
    }
    return u;
  });
  // 逗号后换行（顶层粗略）
  s = s.replace(/,\s*(?![^(]*\))/g, ',\n');
  s = s.replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g,'\n\n');
  // SELECT 列表缩进
  s = s.replace(/\nSELECT\s+/g, '\nSELECT\n  ');
  return s.trim();
}

$('sqlRun').onclick = function(){
  var out = formatSql($('sqlIn').value);
  $('sqlOut').value = out;
  var stats = $('sqlStat');
  if (stats) stats.textContent = $('sqlIn').value.trim() ? (out.split('\n').length + ' 行') : '';
};
$('sqlClear').onclick = function(){ $('sqlIn').value=''; $('sqlOut').value=''; $('sqlStat').textContent=''; };
$('sqlCopy').onclick = function(){ U.copyText($('sqlOut').value); };
$('sqlMin').onclick = function(){
  $('sqlOut').value = String($('sqlIn').value||'').replace(/\s+/g,' ').trim();
};
})();
