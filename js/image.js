/* ============ 图片工具 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc, fmtSize = U.fmtSize;

var items = []; // {file, name, url, canvas, blob, outName, outSize, status}

$('imgQuality').addEventListener('input', function(){ $('imgQVal').textContent = this.value; });
$('imgWatermark').addEventListener('change', function(){
  $('imgWmText').style.display = this.checked ? '' : 'none';
});

$('imgPick').onclick = function(){ $('imgFiles').click(); };
$('imgDrop').onclick = function(e){
  if(e.target.tagName === 'BUTTON') return;
  $('imgFiles').click();
};
$('imgFolder').onclick = async function(){
  if(!U.FS_OK){ notice('err','浏览器不支持文件夹选择，请改用 Chrome / Edge，或点「选择图片」多选。'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'img-dir', mode:'read' });
    var found = 0;
    for await (var entry of h.values()){
      if(entry.kind === 'file' && /\.(png|jpe?g|webp|gif|bmp|ico)$/i.test(entry.name)){
        try{
          var f = await entry.getFile();
          addItem(f);
          found++;
        }catch(e){}
      }
    }
    if(!found) notice('warn','该文件夹下没有找到图片文件');
    else notice('info','已加入 ' + found + ' 张图片');
  }catch(e){
    if(e.name !== 'AbortError') notice('err','选择失败：'+esc(e.message));
  }
};

$('imgFiles').onchange = function(){
  var fs = this.files;
  for(var i=0;i<fs.length;i++) addItem(fs[i]);
  this.value = '';
};

var dragDepth = 0;
$('imgDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('imgDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('imgDrop').addEventListener('drop', function(e){
  e.preventDefault(); this.classList.remove('over');
  var fs = e.dataTransfer.files;
  for(var i=0;i<fs.length;i++){
    if(/^image\//.test(fs[i].type)) addItem(fs[i]);
  }
});

function addItem(file){
  var item = { file:file, name:file.name, url:URL.createObjectURL(file), status:'wait', blob:null };
  items.push(item);
  render();
  $('imgRun').disabled = false;
}

function render(){
  var box = $('imgGrid');
  box.innerHTML = '';
  items.forEach(function(it, i){
    var d = document.createElement('div');
    d.className = 'ph';
    d.innerHTML =
      '<img src="'+esc(it.url)+'" alt="">' +
      '<div class="fn" title="'+esc(it.name)+'">'+esc(it.name)+'</div>' +
      '<div class="fs">'+fmtSize(it.file.size)+
        (it.blob ? ' → ' + fmtSize(it.blob.size) : '') +
        (it.status==='ok' ? ' ✓' : it.status==='err' ? ' ⚠' : '') +
      '</div>';
    box.appendChild(d);
  });
}

$('imgClear').onclick = function(){
  items.forEach(function(it){ try{ URL.revokeObjectURL(it.url); }catch(e){} });
  items = [];
  render();
  $('imgRun').disabled = true;
  $('imgZip').disabled = true;
};

$('imgRun').onclick = async function(){
  if(!items.length) return;
  var btn = this; btn.disabled = true; btn.textContent = '转换中…';
  var fmt = $('imgFmt').value;
  var q = parseInt($('imgQuality').value, 10) / 100;
  var maxSide = parseInt($('imgMax').value, 10) || 0;
  var wm = $('imgWatermark').checked ? $('imgWmText').value : '';
  var bg = $('imgBg').value;
  var ext = fmt === 'image/jpeg' ? '.jpg' : fmt === 'image/png' ? '.png' : '.webp';

  for(var i=0;i<items.length;i++){
    var it = items[i];
    try{
      var img = await loadImage(it.url);
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = maxSide ? Math.min(1, maxSide / Math.max(w,h)) : 1;
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      // 背景
      if(fmt === 'image/jpeg' || (bg !== 'transparent' && bg !== 'auto')){
        ctx.fillStyle = (bg === 'auto' || bg === 'transparent') ? '#ffffff' : bg;
        ctx.fillRect(0,0,cw,ch);
      }else if(bg === 'auto'){
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,cw,ch);
      }
      ctx.drawImage(img, 0, 0, cw, ch);
      if(wm){
        var fsz = Math.max(12, Math.round(cw * 0.04));
        ctx.font = fsz + 'px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = Math.max(1, fsz/10);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        var pad = Math.round(cw * 0.02);
        ctx.strokeText(wm, cw - pad, ch - pad);
        ctx.fillText(wm, cw - pad, ch - pad);
      }
      var blob = await new Promise(function(res){ canvas.toBlob(res, fmt, q); });
      if(!blob) throw new Error('toBlob 失败（格式可能不支持）');
      it.blob = blob;
      it.outName = replaceExt(it.name, ext);
      it.status = 'ok';
    }catch(e){
      it.status = 'err';
      it.err = e.message;
    }
    render();
  }
  btn.disabled = false; btn.textContent = '开始转换';
  $('imgZip').disabled = !items.some(function(it){ return it.blob; });
  var ok = items.filter(function(it){ return it.status==='ok'; }).length;
  notice(ok === items.length ? 'info' : 'warn', '完成：' + ok + '/' + items.length + ' 张');
};

function replaceExt(name, ext){
  return name.replace(/\.[A-Za-z0-9]{1,8}$/, '') + ext;
}
function loadImage(url){
  return new Promise(function(res, rej){
    var img = new Image();
    img.onload = function(){ res(img); };
    img.onerror = function(){ rej(new Error('图片加载失败')); };
    img.src = url;
  });
}

$('imgZip').onclick = async function(){
  var okItems = items.filter(function(it){ return it.blob; });
  if(!okItems.length){ notice('warn','没有已转换的图片'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '打包中…';
  try{
    var files = [];
    var used = Object.create(null);
    for(var i=0;i<okItems.length;i++){
      var nm = okItems[i].outName || okItems[i].name;
      var k = 1, base = nm;
      while(used[nm]){ nm = base.replace(/(\.[^.]+)$/, '') + '_' + (++k) + '$1'; nm = base.replace(/(\.[A-Za-z0-9]+)$/, function(_,e){ return '_'+k+e; }); }
      used[nm] = 1;
      files.push({ name: nm, data: new Uint8Array(await okItems[i].blob.arrayBuffer()) });
    }
    var zip = await U.makeZip(files);
    U.saveBlob(zip, '图片转换结果.zip');
    notice('info','已下载 zip（' + files.length + ' 张）');
  }catch(e){
    notice('err','打包失败：'+esc(e.message));
  }finally{
    btn.disabled = false; btn.textContent = '打包下载 ZIP';
  }
};
})();
