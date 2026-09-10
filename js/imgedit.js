/* ============ 图片裁剪 + 长图拼接 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc, fmtSize = U.fmtSize;

function loadImageEl(src){
  return new Promise(function(res, rej){
    var img = new Image();
    img.onload = function(){ res(img); };
    img.onerror = function(){ rej(new Error('图片加载失败')); };
    img.src = src;
  });
}
function blobToUrl(blob){ return URL.createObjectURL(blob); }
function canvasToBlob(canvas, type, q){
  return new Promise(function(res){ canvas.toBlob(res, type || 'image/png', q); });
}

/* ================= 裁剪 ================= */
var crop = {
  img: null, file: null, url: null,
  sx:0, sy:0, sw:0, sh:0,   // 选区（图像坐标）
  dragging:false, startX:0, startY:0,
  lockRatio:false
};

var cv = $('cropCanvas');
var ctx = cv.getContext('2d');
var wrap = $('cropStage');

function setCropFile(file){
  crop.file = file;
  if (crop.url) URL.revokeObjectURL(crop.url);
  crop.url = blobToUrl(file);
  loadImageEl(crop.url).then(function(img){
    crop.img = img;
    var maxW = Math.min(720, wrap.clientWidth - 8);
    var scale = Math.min(1, maxW / img.naturalWidth);
    cv.width = Math.round(img.naturalWidth * scale);
    cv.height = Math.round(img.naturalHeight * scale);
    cv.style.width = cv.width + 'px';
    cv.style.height = cv.height + 'px';
    cv.style.display = 'inline-block';
    crop.scale = scale;
    // 默认全图
    crop.sx = 0; crop.sy = 0; crop.sw = img.naturalWidth; crop.sh = img.naturalHeight;
    $('cropInfo').textContent = file.name + ' · ' + img.naturalWidth + '×' + img.naturalHeight + ' · ' + fmtSize(file.size);
    drawCrop();
  }).catch(function(e){ notice('err', e.message); });
}

function drawCrop(){
  if (!crop.img) return;
  ctx.clearRect(0,0,cv.width,cv.height);
  ctx.drawImage(crop.img, 0, 0, cv.width, cv.height);
  // 遮罩
  var s = crop.scale;
  var x = crop.sx * s, y = crop.sy * s, w = crop.sw * s, h = crop.sh * s;
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.fillRect(0,0,cv.width,y);
  ctx.fillRect(0,y+h,cv.width,cv.height-y-h);
  ctx.fillRect(0,y,x,h);
  ctx.fillRect(x+w,y,cv.width-x-w,h);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.strokeRect(x,y,w,h);
  // 尺寸角标
  ctx.fillStyle = '#2563eb';
  ctx.font = '12px system-ui,sans-serif';
  ctx.fillText(Math.round(crop.sw) + '×' + Math.round(crop.sh), x+4, Math.max(14, y-4));
}

function cropPoint(ev){
  var rect = cv.getBoundingClientRect();
  var px = (ev.clientX - rect.left) / rect.width * cv.width / crop.scale;
  var py = (ev.clientY - rect.top) / rect.height * cv.height / crop.scale;
  return { x: Math.max(0, Math.min(crop.img.naturalWidth, px)), y: Math.max(0, Math.min(crop.img.naturalHeight, py)) };
}

cv.addEventListener('mousedown', function(ev){
  if (!crop.img) return;
  ev.preventDefault();
  var p = cropPoint(ev);
  crop.dragging = true;
  crop.startX = p.x; crop.startY = p.y;
  crop.sx = p.x; crop.sy = p.y; crop.sw = 0; crop.sh = 0;
});
window.addEventListener('mousemove', function(ev){
  if (!crop.dragging || !crop.img) return;
  var p = cropPoint(ev);
  var x = Math.min(crop.startX, p.x), y = Math.min(crop.startY, p.y);
  var w = Math.abs(p.x - crop.startX), h = Math.abs(p.y - crop.startY);
  if (crop.lockRatio && crop.lockRatio > 0){
    var r = crop.lockRatio;
    if (w / h > r) h = w / r; else w = h * r;
    if (p.x < crop.startX) x = crop.startX - w;
    if (p.y < crop.startY) y = crop.startY - h;
    w = Math.min(w, crop.img.naturalWidth - x);
    h = w / r;
  }
  crop.sx = x; crop.sy = y; crop.sw = w; crop.sh = h;
  drawCrop();
});
window.addEventListener('mouseup', function(){
  crop.dragging = false;
});

$('cropPick').onclick = function(){ $('cropFiles').click(); };
$('cropFiles').onchange = function(){
  if (this.files[0]) setCropFile(this.files[0]);
  this.value = '';
};
$('cropDrop').onclick = function(e){
  if (e.target.tagName === 'BUTTON') return;
  $('cropFiles').click();
};
$('cropDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('cropDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('cropDrop').addEventListener('drop', function(e){
  e.preventDefault(); this.classList.remove('over');
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f && /^image\//.test(f.type)) setCropFile(f);
});

$('cropRatio').onchange = function(){
  var v = this.value;
  crop.lockRatio = v === 'free' ? 0 : (function(){
    var m = v.split(':');
    return parseFloat(m[0]) / parseFloat(m[1]);
  })();
  if (crop.lockRatio && crop.img){
    // 按当前中心重算
    var cx = crop.sx + crop.sw/2, cy = crop.sy + crop.sh/2;
    var h = crop.sw / crop.lockRatio;
    var y = cy - h/2;
    if (y < 0) y = 0;
    if (y + h > crop.img.naturalHeight) y = Math.max(0, crop.img.naturalHeight - h);
    crop.sy = y; crop.sh = Math.min(h, crop.img.naturalHeight - y);
    crop.sx = Math.max(0, Math.min(crop.sx, crop.img.naturalWidth - crop.sw));
    drawCrop();
  }
};
$('cropFull').onclick = function(){
  if (!crop.img) return;
  crop.sx = 0; crop.sy = 0; crop.sw = crop.img.naturalWidth; crop.sh = crop.img.naturalHeight;
  drawCrop();
};
$('cropClear').onclick = function(){
  if (crop.url) URL.revokeObjectURL(crop.url);
  crop = { img:null, file:null, url:null, sx:0,sy:0,sw:0,sh:0, dragging:false, lockRatio:0 };
  ctx.clearRect(0,0,cv.width,cv.height);
  cv.width = 1; cv.height = 1;
  $('cropInfo').textContent = '尚未选择图片';
  $('cropOutMsg').textContent = '';
};

$('cropRun').onclick = async function(){
  if (!crop.img || crop.sw < 1 || crop.sh < 1){ notice('warn','请先选择图片并框选区域'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '裁剪中…';
  try{
    var c = document.createElement('canvas');
    c.width = Math.round(crop.sw);
    c.height = Math.round(crop.sh);
    var cx = c.getContext('2d');
    var bg = $('cropBg').value;
    if (bg !== 'transparent'){ cx.fillStyle = bg; cx.fillRect(0,0,c.width,c.height); }
    cx.drawImage(crop.img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, c.width, c.height);
    var type = $('cropFmt').value;
    var q = parseInt($('cropQuality').value,10)/100;
    var blob = await canvasToBlob(c, type, q);
    var base = (crop.file.name || 'image').replace(/\.[A-Za-z0-9]+$/, '');
    var ext = type === 'image/jpeg' ? '.jpg' : type === 'image/webp' ? '.webp' : '.png';
    U.saveBlob(blob, base + '_crop' + ext);
    $('cropOutMsg').textContent = '已导出 ' + base + '_crop' + ext + '（' + c.width + '×' + c.height + ' · ' + fmtSize(blob.size) + '）';
    notice('info','裁剪完成');
  }catch(e){
    notice('err','裁剪失败：' + esc(e.message));
  }finally{
    btn.disabled = false; btn.textContent = '导出裁剪结果';
  }
};

/* ================= 长图拼接 ================= */
var stitchImgs = []; // {file, url, img, w, h}

function renderStitchList(){
  var box = $('stitchList');
  if (!stitchImgs.length){
    box.innerHTML = '<div class="muted">尚未添加图片</div>';
    $('stitchRun').disabled = true;
    return;
  }
  $('stitchRun').disabled = false;
  var h = '<div class="rtable"><table><thead><tr><th>#</th><th>文件</th><th>尺寸</th><th>操作</th></tr></thead><tbody>';
  stitchImgs.forEach(function(it, i){
    h += '<tr><td>'+(i+1)+'</td><td class="mono">'+esc(it.file.name)+'</td>' +
      '<td>'+it.w+'×'+it.h+'</td><td style="white-space:nowrap">' +
      '<button class="sm" data-su="'+i+'">↑</button> ' +
      '<button class="sm" data-sd="'+i+'">↓</button> ' +
      '<button class="sm dan" data-sx="'+i+'">✕</button></td></tr>';
  });
  h += '</tbody></table></div>';
  box.innerHTML = h;
  box.querySelectorAll('[data-su]').forEach(function(b){
    b.onclick = function(){ swapStitch(+b.getAttribute('data-su'), -1); };
  });
  box.querySelectorAll('[data-sd]').forEach(function(b){
    b.onclick = function(){ swapStitch(+b.getAttribute('data-sd'), 1); };
  });
  box.querySelectorAll('[data-sx]').forEach(function(b){
    b.onclick = function(){
      var i = +b.getAttribute('data-sx');
      URL.revokeObjectURL(stitchImgs[i].url);
      stitchImgs.splice(i,1);
      renderStitchList();
    };
  });
}
function swapStitch(i, d){
  var j = i + d;
  if (j < 0 || j >= stitchImgs.length) return;
  var t = stitchImgs[i]; stitchImgs[i] = stitchImgs[j]; stitchImgs[j] = t;
  renderStitchList();
}

async function addStitchFiles(fileList){
  var arr = Array.from(fileList || []).filter(function(f){ return /^image\//.test(f.type); });
  if (!arr.length){ notice('warn','请添加图片'); return; }
  for (var i=0;i<arr.length;i++){
    var url = blobToUrl(arr[i]);
    try{
      var img = await loadImageEl(url);
      stitchImgs.push({ file: arr[i], url: url, img: img, w: img.naturalWidth, h: img.naturalHeight });
    }catch(e){
      URL.revokeObjectURL(url);
    }
  }
  renderStitchList();
  notice('info','已加入 ' + arr.length + ' 张图片');
}

$('stitchPick').onclick = function(){ $('stitchFiles').click(); };
$('stitchFiles').onchange = function(){ addStitchFiles(this.files); this.value = ''; };
$('stitchDrop').onclick = function(e){
  if (e.target.tagName === 'BUTTON') return;
  $('stitchFiles').click();
};
$('stitchDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('stitchDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('stitchDrop').addEventListener('drop', function(e){
  e.preventDefault(); this.classList.remove('over');
  addStitchFiles(e.dataTransfer.files);
});
$('stitchClear').onclick = function(){
  stitchImgs.forEach(function(it){ URL.revokeObjectURL(it.url); });
  stitchImgs = [];
  renderStitchList();
  $('stitchOutMsg').textContent = '';
};

$('stitchRun').onclick = async function(){
  if (stitchImgs.length < 1){ notice('warn','请先添加图片'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '拼接中…';
  try{
    var dir = $('stitchDir').value; // v | h
    var gap = parseInt($('stitchGap').value, 10) || 0;
    var bg = $('stitchBg').value;
    var maxWidth = parseInt($('stitchMax').value, 10) || 0;
    var gapColor = bg === 'transparent' ? '#ffffff' : bg;

    var list = stitchImgs.map(function(it){ return it.img; });
    var W, H;
    if (dir === 'v'){
      var maxW = Math.max.apply(null, list.map(function(im){ return im.naturalWidth; }));
      if (maxWidth && maxW > maxWidth){
        var sc = maxWidth / maxW;
        list = list.map(function(im){
          var c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * sc);
          c.height = Math.round(im.naturalHeight * sc);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          return c;
        });
        maxW = list[0].width;
      }
      var heights = list.map(function(im){ return im.height || im.naturalHeight; });
      var widths = list.map(function(im){ return im.width || im.naturalWidth; });
      W = Math.max.apply(null, widths);
      H = heights.reduce(function(a,b){ return a+b; }, 0) + gap * (list.length - 1);
    } else {
      var maxH = Math.max.apply(null, list.map(function(im){ return im.naturalHeight; }));
      if (maxWidth && maxH > maxWidth){
        var sc2 = maxWidth / maxH;
        list = list.map(function(im){
          var c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * sc2);
          c.height = Math.round(im.naturalHeight * sc2);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          return c;
        });
        maxH = list[0].height;
      }
      var hs = list.map(function(im){ return im.height || im.naturalHeight; });
      var ws = list.map(function(im){ return im.width || im.naturalWidth; });
      H = Math.max.apply(null, hs);
      W = ws.reduce(function(a,b){ return a+b; }, 0) + gap * (list.length - 1);
    }

    var c = document.createElement('canvas');
    c.width = Math.max(1, W); c.height = Math.max(1, H);
    var cx = c.getContext('2d');
    if (bg !== 'transparent'){ cx.fillStyle = bg; cx.fillRect(0,0,c.width,c.height); }
    var x = 0, y = 0;
    list.forEach(function(im){
      var iw = im.width || im.naturalWidth;
      var ih = im.height || im.naturalHeight;
      var ix = dir === 'v' ? Math.round((W - iw)/2) : x;
      var iy = dir === 'v' ? y : Math.round((H - ih)/2);
      cx.drawImage(im, ix, iy, iw, ih);
      if (dir === 'v') y += ih + gap;
      else x += iw + gap;
    });
    var type = $('stitchFmt').value;
    var q = parseInt($('stitchQuality').value,10)/100;
    var blob = await canvasToBlob(c, type, q);
    U.saveBlob(blob, (dir === 'v' ? '竖向长图' : '横向长图') + '_' + list.length + '张' + (type==='image/jpeg'?'.jpg':type==='image/webp'?'.webp':'.png'));
    $('stitchOutMsg').textContent = '输出 ' + c.width + '×' + c.height + ' · ' + fmtSize(blob.size);
    notice('info','拼接完成');
  }catch(e){
    notice('err','拼接失败：' + esc(e.message));
  }finally{
    btn.disabled = false; btn.textContent = '生成长图';
  }
};

$('stitchQuality').addEventListener('input', function(){
  var el = $('stitchQVal'); if (el) el.textContent = this.value;
});
$('cropQuality').addEventListener('input', function(){
  var el = $('cropQVal'); if (el) el.textContent = this.value;
});

renderStitchList();
$('cropInfo').textContent = '尚未选择图片';
})();
