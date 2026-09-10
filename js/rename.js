/* ============ 批量重命名 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

var dirHandle = null;
var files = []; // {name, handle, file?}
var preview = []; // {from, to, ok}

function setHint(s){ $('rnHint').textContent = s; }

async function loadFolder(){
  if (!U.FS_OK){ notice('err','请用 Chrome / Edge，才能对文件夹内文件直接改名'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'rn-dir', mode:'readwrite' });
    dirHandle = h;
    $('rnPath').value = h.name + '\\';
    files = [];
    for await (var entry of h.values()){
      if (entry.kind === 'file' && !/^_checksums|^\./.test(entry.name)){
        files.push({ name: entry.name, handle: entry });
      }
    }
    files.sort(function(a,b){ return a.name.localeCompare(b.name,'zh'); });
    setHint('已加载 ' + files.length + ' 个文件');
    buildPreview();
    notice('info','已加载 ' + h.name + ' 下 ' + files.length + ' 个文件');
  }catch(e){
    if (e.name !== 'AbortError') notice('err','选择失败：'+esc(e.message));
  }
}
$('rnBrowse').onclick = loadFolder;

$('rnDrop').onclick = function(){ $('rnBrowse').click(); };
$('rnDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('rnDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('rnDrop').addEventListener('drop', async function(e){
  e.preventDefault(); this.classList.remove('over');
  var list = Array.from(e.dataTransfer.files || []);
  if (!list.length) return;
  dirHandle = null;
  $('rnPath').value = '(拖入的文件，导出为 ZIP)';
  files = list.map(function(f){ return { name: f.name, file: f, handle: null }; });
  setHint('已加载 ' + files.length + ' 个文件（拖入模式：导出 ZIP，不原地改名）');
  buildPreview();
});

function safe(s){
  return String(s).replace(/[\\\/:*?"<>|]/g,'_').trim();
}

function transform(name, i){
  var stem = name.replace(/\.[^.]+$/, '');
  var ext = (name.match(/\.[^.]+$/) || [''])[0];
  var mode = $('rnMode').value;
  var out = stem;
  if (mode === 'replace'){
    var from = $('rnFrom').value;
    var to = $('rnTo').value;
    if (from) out = stem.split(from).join(to);
  } else if (mode === 'prefix'){
    out = $('rnPre').value + stem;
  } else if (mode === 'suffix'){
    out = stem + $('rnSuf').value;
  } else if (mode === 'number'){
    var start = parseInt($('rnNumStart').value, 10) || 1;
    var pad = parseInt($('rnNumPad').value, 10) || 2;
    var n = String(start + i).padStart(pad, '0');
    var tpl = $('rnNumTpl').value || '{n}_{name}';
    out = tpl.replace('{n}', n).replace('{name}', stem);
  } else if (mode === 'lower'){
    out = stem.toLowerCase();
  } else if (mode === 'upper'){
    out = stem.toUpperCase();
  } else if (mode === 'trim'){
    out = stem.replace(/^[\s._-]+|[\s._-]+$/g,'');
  } else if (mode === 'pinyin-ish'){
    // 仅去掉空白与常见符号，保留中文
    out = stem.replace(/\s+/g,'_').replace(/[()（）\[\]]/g,'');
  }
  var finalName = safe(out) + ($('rnKeepExt').checked ? ext : '');
  if ($('rnLowerExt').checked && finalName){
    var d = finalName.lastIndexOf('.');
    if (d > 0) finalName = finalName.slice(0,d).toLowerCase() + finalName.slice(d).toLowerCase();
  }
  return finalName;
}

function buildPreview(){
  preview = files.map(function(f, i){
    var to = transform(f.name, i);
    var clash = files.some(function(o, j){
      return j !== i && transform(o.name, j) === to;
    });
    return { from: f.name, to: to, ok: !!to && to !== '.' && !clash, clash: clash };
  });
  var box = $('rnList');
  if (!files.length){
    box.innerHTML = '<div class="muted">尚未选择文件</div>';
    $('rnRun').disabled = true;
    return;
  }
  $('rnRun').disabled = false;
  var h = '<div class="rtable"><table><thead><tr><th>#</th><th>原名</th><th></th><th>新名</th><th>状态</th></tr></thead><tbody>';
  preview.forEach(function(p, i){
    var st = !p.to ? '空名' : p.clash ? '重名' : p.from === p.to ? '不变' : '就绪';
    var color = st === '就绪' ? 'var(--ok)' : st === '不变' ? 'var(--tx3)' : 'var(--err)';
    h += '<tr><td>'+(i+1)+'</td><td class="mono">'+esc(p.from)+'</td>' +
      '<td class="muted">→</td><td class="mono" style="color:'+color+'">'+esc(p.to||'')+'</td>' +
      '<td style="color:'+color+'">'+st+'</td></tr>';
  });
  h += '</tbody></table></div>';
  box.innerHTML = h;
  var okN = preview.filter(function(p){ return p.ok && p.from !== p.to; }).length;
  setHint('将重命名 ' + okN + ' / ' + files.length + ' 个文件');
}

['rnMode','rnFrom','rnTo','rnPre','rnSuf','rnNumStart','rnNumPad','rnNumTpl','rnKeepExt','rnLowerExt'].forEach(function(id){
  var el = $(id);
  if (!el) return;
  el.addEventListener('input', function(){
    $('rnReplaceRow').style.display = $('rnMode').value === 'replace' ? '' : 'none';
    $('rnPreRow').style.display = $('rnMode').value === 'prefix' ? '' : 'none';
    $('rnSufRow').style.display = $('rnMode').value === 'suffix' ? '' : 'none';
    $('rnNumRow').style.display = $('rnMode').value === 'number' ? '' : 'none';
    buildPreview();
  });
  el.addEventListener('change', function(){
    $('rnReplaceRow').style.display = $('rnMode').value === 'replace' ? '' : 'none';
    $('rnPreRow').style.display = $('rnMode').value === 'prefix' ? '' : 'none';
    $('rnSufRow').style.display = $('rnMode').value === 'suffix' ? '' : 'none';
    $('rnNumRow').style.display = $('rnMode').value === 'number' ? '' : 'none';
    buildPreview();
  });
});
$('rnMode').dispatchEvent(new Event('change'));

$('rnRun').onclick = async function(){
  if (!files.length){ notice('warn','请先选择文件'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '处理中…';
  try{
    var jobs = [];
    for (var i=0;i<files.length;i++){
      var p = preview[i];
      if (!p.ok || p.from === p.to) continue;
      jobs.push({ file: files[i], to: p.to });
    }
    if (!jobs.length){ notice('info','没有需要改名的文件'); return; }

    if (dirHandle){
      // 原地改名：先改成临时名再改成目标，避免冲突
      for (var k=0;k<jobs.length;k++){
        var j = jobs[k];
        var tmp = '.rn_tmp_' + k + '_' + j.to;
        await j.file.handle.move(dirHandle, tmp);
        j.file.handle = await dirHandle.getFileHandle(tmp);
        j._tmp = tmp;
      }
      for (var k=0;k<jobs.length;k++){
        var j = jobs[k];
        await j.file.handle.move(dirHandle, j.to);
      }
      notice('info','已在文件夹内完成 ' + jobs.length + ' 个重命名');
      files = [];
      for await (var entry of dirHandle.values()){
        if (entry.kind === 'file' && !/^\./.test(entry.name)) files.push({ name: entry.name, handle: entry });
      }
      files.sort(function(a,b){ return a.name.localeCompare(b.name,'zh'); });
      buildPreview();
    } else {
      // 拖入模式：打包 ZIP
      var zipFiles = [];
      for (var k=0;k<jobs.length;k++){
        var buf = new Uint8Array(await jobs[k].file.file.arrayBuffer());
        zipFiles.push({ name: jobs[k].to, data: buf });
      }
      var zip = await U.makeZip(zipFiles);
      U.saveBlob(zip, '重命名结果.zip');
      notice('info','已导出 ZIP（' + zipFiles.length + ' 个文件）');
    }
  }catch(e){
    notice('err','重命名失败：' + esc(e.message));
    console.error(e);
  }finally{
    btn.disabled = false; btn.textContent = '执行重命名';
  }
};
})();
