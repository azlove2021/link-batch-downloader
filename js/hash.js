/* ============ 哈希校验 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc, fmtSize = U.fmtSize;

var HashUI = {
  fileHandle: null, fileName: '',
  folderHandle: null, folderName: '',
  busy: false,
  results: []
};

$('btnHashFile').onclick = async function(){
  if(!U.FS_OK){ notice('err','浏览器不支持，请用 Chrome / Edge。'); return; }
  try{
    var handles = await window.showOpenFilePicker({ multiple:false });
    if(!handles || !handles.length) return;
    HashUI.fileHandle = handles[0];
    HashUI.fileName = handles[0].name;
    $('hashPathFile').value = HashUI.fileName;
    HashUI.folderHandle = null;
    $('hashPathFolder').value = '';
    HashUI.folderName = '';
    $('btnHashCalc').disabled = false;
    $('hashHint').textContent = '已选文件：' + HashUI.fileName;
    $('hashResult').classList.remove('on');
    $('hashResult').innerHTML = '';
  }catch(e){
    if(e.name !== 'AbortError') notice('err','选择文件失败：' + esc(e.message));
  }
};

$('btnHashFolder').onclick = async function(){
  if(!U.FS_OK){ notice('err','浏览器不支持，请用 Chrome / Edge。'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'hash-folder', mode:'read' });
    HashUI.folderHandle = h;
    HashUI.folderName = h.name;
    $('hashPathFolder').value = h.name + '\\';
    HashUI.fileHandle = null;
    HashUI.fileName = '';
    $('hashPathFile').value = '';
    $('btnHashCalc').disabled = false;
    $('hashHint').textContent = '已选文件夹：' + h.name + '（将递归所有文件）';
    $('hashResult').classList.remove('on');
    $('hashResult').innerHTML = '';
  }catch(e){
    if(e.name !== 'AbortError') notice('err','选择文件夹失败：' + esc(e.message));
  }
};

$('btnHashReset').onclick = function(){
  HashUI.fileHandle = null;
  HashUI.folderHandle = null;
  HashUI.fileName = '';
  HashUI.folderName = '';
  $('hashPathFile').value = '';
  $('hashPathFolder').value = '';
  $('hashResult').classList.remove('on');
  $('hashResult').innerHTML = '';
  $('btnHashCalc').disabled = true;
  $('hashHint').textContent = '先选择文件或文件夹';
};

$('btnHashCalc').onclick = async function(){
  if(HashUI.busy) return;
  if(!HashUI.fileHandle && !HashUI.folderHandle){ notice('warn','请先选择文件或文件夹。'); return; }
  var wantSha = $('hashAlgoSha').checked;
  var wantMd5 = $('hashAlgoMd5').checked;
  if(!wantSha && !wantMd5){ notice('warn','至少选一个算法。'); return; }
  HashUI.busy = true;
  $('btnHashCalc').disabled = true;
  HashUI.results = [];
  var totalSize = 0, doneSize = 0;
  var files = [];
  try{
    if(HashUI.fileHandle){
      var f = await HashUI.fileHandle.getFile();
      files.push({ handle:HashUI.fileHandle, name:HashUI.fileName, file:f });
    }else{
      files = await collectAllFiles(HashUI.folderHandle, '');
    }
    if(!files.length){
      notice('warn','文件夹里没有文件。');
      HashUI.busy = false; $('btnHashCalc').disabled = false;
      return;
    }
    totalSize = files.reduce(function(s, x){ return s + x.file.size; }, 0);
    renderHashTable(files);
    for(var i=0;i<files.length;i++){
      var x = files[i];
      var row = { name:x.name, size:x.file.size, sha:null, md5:null, err:null, run:true };
      HashUI.results[i] = row;
      try{
        if(wantSha){
          row.sha = await U.sha256Of(x.file);
          doneSize += x.file.size;
          updateHashProgress(doneSize, totalSize);
        }
        if(wantMd5){
          if(x.file.size > 100 * 1024 * 1024){
            row.err = 'MD5 跳过（>100MB）';
          }else{
            row.md5 = await U.md5OfFile(x.file);
            doneSize += x.file.size;
            updateHashProgress(doneSize, totalSize);
          }
        }
      }catch(e){
        row.err = e.message || String(e);
      }
      row.run = false;
      updateHashRow(i, row);
    }
    $('hashHint').textContent = '完成：' + files.length + ' 个文件';
    if(HashUI.folderHandle && $('hashWriteFile').checked && wantSha){
      var hasSha = HashUI.results.filter(function(r){ return r.sha; }).length;
      if(hasSha){
        try{
          var fh = await HashUI.folderHandle.getFileHandle('_checksums.sha256.txt', {create:true});
          var w = await fh.createWritable();
          var lines = ['# SHA-256 校验和（由 办公工具箱 生成）'];
          lines.push('# 文件夹：' + HashUI.folderName + '\\');
          lines.push('# 生成时间：' + new Date().toLocaleString('zh-CN'));
          HashUI.results.forEach(function(r){
            if(r.sha) lines.push(r.sha + '  ' + r.name);
          });
          await w.write(lines.join('\n') + '\n');
          await w.close();
          $('hashHint').textContent += '，已写 _checksums.sha256.txt';
        }catch(e){
          notice('warn','写入 _checksums.sha256.txt 失败：' + (e.message || e));
        }
      }
    }
  }catch(e){
    notice('err','计算失败：' + esc(e.message || e));
  }finally{
    HashUI.busy = false;
    $('btnHashCalc').disabled = false;
  }
};

async function collectAllFiles(dirHandle, prefix){
  var out = [];
  for await (var entry of dirHandle.values()){
    if(entry.kind === 'file'){
      try{
        var f = await entry.getFile();
        out.push({ handle:entry, name: prefix + entry.name, file:f });
      }catch(e){}
    }else if(entry.kind === 'directory'){
      if(/^(\.|node_modules|__pycache__|\$RECYCLE\.BIN|System Volume Information)/i.test(entry.name)) continue;
      try{
        var sub = await collectAllFiles(entry, prefix + entry.name + '\\');
        out = out.concat(sub);
      }catch(e){}
    }
  }
  return out;
}

function renderHashTable(files){
  var box = $('hashResult');
  box.innerHTML = '';
  box.classList.add('on');
  var summary = document.createElement('div');
  summary.className = 'hsum';
  summary.style.flexDirection = 'column';
  summary.style.alignItems = 'stretch';
  summary.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
    '  <span style="flex:0 0 76px;font-weight:600;color:var(--pri)">整体</span>' +
    '  <span class="muted">共 <b>' + files.length + '</b> 个文件，<b>' +
      U.fmtSize(files.reduce(function(s,x){return s+x.file.size;},0)) + '</b></span>' +
    '  <span id="hashProgressTxt" style="margin-left:auto"></span>' +
    '</div>' +
    '<div class="prog" style="margin-top:9px">' +
    '  <span class="sp"></span><span>计算中</span>' +
    '  <div class="pbar"><i id="hashPbar"></i></div>' +
    '</div>';
  box.appendChild(summary);
  var t = document.createElement('div');
  t.className = 'htable';
  var rh = document.createElement('div');
  rh.className = 'rh';
  rh.innerHTML = '<div>文件名</div><div>SHA-256</div><div>MD5</div><div>大小</div>';
  t.appendChild(rh);
  for(var i=0;i<files.length;i++){
    var r = document.createElement('div');
    r.className = 'rd run';
    r.id = 'hr' + i;
    r.innerHTML =
      '<div class="nm"><span class="sp"></span>' + esc(files[i].name) + '</div>' +
      '<div class="hv" data-k="sha">…</div>' +
      '<div class="hv" data-k="md5">' + ($('hashAlgoMd5').checked ? '…' : '—') + '</div>' +
      '<div class="sz">' + fmtSize(files[i].file.size) + '</div>';
    t.appendChild(r);
  }
  box.appendChild(t);
}
function updateHashProgress(done, total){
  var pct = total ? Math.min(100, Math.floor(done*100/total)) : 0;
  var bar = $('hashPbar'); if(bar) bar.style.width = pct + '%';
  var txt = $('hashProgressTxt'); if(txt) txt.textContent = pct + '%  (' + fmtSize(done) + '/' + fmtSize(total) + ')';
}
function updateHashRow(i, row){
  var el = $('hr' + i);
  if(!el) return;
  el.classList.toggle('run', !!row.run);
  el.classList.toggle('err', !!row.err);
  if(row.run){
    var shaEl = el.querySelector('[data-k=sha]');
    var md5El = el.querySelector('[data-k=md5]');
    if(shaEl && !shaEl.dataset.did) shaEl.textContent = row.sha ? row.sha : '…';
    if(md5El && !md5El.dataset.did && $('hashAlgoMd5').checked) md5El.textContent = row.md5 ? row.md5 : '…';
  }else{
    el.querySelector('.sp').outerHTML = (row.err ? '⚠' : (row.sha ? '✓' : '○'));
    var shaEl = el.querySelector('[data-k=sha]');
    var md5El = el.querySelector('[data-k=md5]');
    if(shaEl){ shaEl.textContent = row.sha || '—'; shaEl.dataset.did = '1'; shaEl.title = row.sha || ''; }
    if(md5El){ md5El.textContent = row.md5 || '—'; md5El.dataset.did = '1'; md5El.title = row.md5 || ''; }
  }
}
})();

/* ======== 由 extra-tools.js 合并：哈希对比 ======== */
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
