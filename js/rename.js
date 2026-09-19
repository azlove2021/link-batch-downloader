/* ============ 批量重命名 ============
 * 设计原则：先预览再执行，绝不盲改；每次执行都可撤销；日期识别等纯逻辑
 * 放在 js/rename-core.js，便于单元测试（tests/rename-core.test.cjs）。
 */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;
var RC = TB.renameCore || {}; // 纯函数核心（日期识别/格式化）

var dirHandle = null;
var files = [];      // {name, handle, file?}
var preview = [];    // {from, to, ok, clash, noDate}
var others = [];     // 文件夹里存在、但不参与改名的文件（隐藏文件等），用于冲突检测
var undoStack = [];  // 撤销栈：每项是一次改名的 [{from,to}]，最多保留 5 次
var logEntries = []; // 改名记录，可导出 CSV 留档

function setHint(s){ $('rnHint').textContent = s; }

/* ---------- 一致性 UI ---------- */
function syncModeRows(){
  var mode = $('rnMode').value;
  $('rnReplaceRow').style.display = mode === 'replace' ? '' : 'none';
  $('rnPreRow').style.display = mode === 'prefix' ? '' : 'none';
  $('rnSufRow').style.display = mode === 'suffix' ? '' : 'none';
  $('rnNumRow').style.display = mode === 'number' ? '' : 'none';
  if ($('rnDateRow')) $('rnDateRow').style.display = mode === 'date' ? '' : 'none';
  if ($('rnDateTip')) $('rnDateTip').style.display = mode === 'date' ? '' : 'none';
}

function refreshUndoUi(){
  var u = $('rnUndo'), l = $('rnLog');
  if (u){
    u.disabled = !(undoStack.length > 0 && dirHandle);
    u.textContent = undoStack.length > 1
      ? ('撤销上次（可退 ' + undoStack.length + ' 步）')
      : '撤销上次';
  }
  if (l) l.disabled = !logEntries.length;
  if ($('rnToFolder')) $('rnToFolder').disabled = !dirHandle;
}

/* ---------- 载入 ---------- */
/* 列出文件夹内容；载入与「撤销后刷新」共用同一份逻辑，避免两边走偏 */
async function reloadFolder(){
  if (!dirHandle) return;
  files = []; others = [];
  for await (var entry of dirHandle.values()){
    if (entry.kind !== 'file') continue;
    if (/^_checksums|^\./.test(entry.name)){ others.push(entry.name); continue; }
    files.push({ name: entry.name, handle: entry });
  }
  files.sort(function(a,b){ return a.name.localeCompare(b.name,'zh'); });
  buildPreview();
}

async function loadFolder(){
  if (!U.FS_OK){ notice('err','请用 Chrome / Edge，才能对文件夹内文件直接改名'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'rn-dir', mode:'readwrite' });
    dirHandle = h;
    $('rnPath').value = h.name + '\\';
    await reloadFolder();
    setHint('已加载 ' + files.length + ' 个文件');
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
  others = []; undoStack = [];
  $('rnPath').value = '(拖入的文件，导出为 ZIP)';
  files = list.map(function(f){ return { name: f.name, file: f, handle: null }; });
  setHint('已加载 ' + list.length + ' 个文件（拖入模式：导出 ZIP，不原地改名）');
  buildPreview();
  refreshUndoUi();
});

/* ---------- 规则 ---------- */
function safe(s){
  return RC.sanitize ? RC.sanitize(s) : String(s).replace(/[\\/:*?"<>|]/g,'_').trim();
}

/* 日期模式：从文件名里认出日期并按模板重排。
 * 认不出日期就返回空字符串，由预览标红跳过 —— 绝不瞎改。 */
function dateName(stem){
  if (!RC.extractDate) return '';
  var found = RC.extractDate(stem);
  if (!found) return '';
  var style = $('rnDateSep') ? $('rnDateSep').value : '-';
  var tpl = ($('rnDateTpl') && $('rnDateTpl').value) || '{date}_{name}';
  return RC.applyTemplate(tpl, RC.formatDate(found, style), found.rest, stem);
}

function hasDate(name){
  if (!RC.extractDate) return true;
  return !!RC.extractDate(name);
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
  } else if (mode === 'date'){
    out = dateName(stem);
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
  }
  var finalName = safe(out) + ($('rnKeepExt').checked ? ext : '');
  if ($('rnLowerExt').checked && finalName){
    var d = finalName.lastIndexOf('.');
    if (d > 0) finalName = finalName.slice(0,d).toLowerCase() + finalName.slice(d).toLowerCase();
  }
  return finalName;
}

/* ---------- 预览 ---------- */
function buildPreview(){
  var isDate = $('rnMode').value === 'date';
  /* 目标名只算一遍，避免在 O(n²) 比较里反复重算 */
  var targets = files.map(function(f, i){ return transform(f.name, i); });
  var lower = targets.map(function(t){ return String(t).toLowerCase(); });
  var otherLower = others.map(function(n){ return String(n).toLowerCase(); });

  preview = files.map(function(f, i){
    var to = targets[i];
    var noDate = isDate && !hasDate(f.name);
    var key = lower[i];
    var clash = !!to && (
      lower.some(function(t, j){ return j !== i && t === key; }) ||
      otherLower.indexOf(key) >= 0   // 撞上文件夹里没参与改名的文件（Windows 不区分大小写）
    );
    var bad = !to || to === '.' || noDate || clash;
    return { from: f.name, to: to, noDate: noDate, clash: clash, ok: !bad };
  });

  var box = $('rnList');
  if (!files.length){
    box.innerHTML = '<div class="muted">尚未选择文件</div>';
    $('rnRun').disabled = true;
    setHint('尚未选择');
    refreshUndoUi();
    return;
  }
  var h = '<div class="rtable"><table><thead><tr><th>#</th><th>原名</th><th></th><th>新名</th><th>状态</th></tr></thead><tbody>';
  preview.forEach(function(p, i){
    var st = p.noDate ? '未识别日期'
           : !p.to ? '空名'
           : p.clash ? '重名（会覆盖）'
           : p.from === p.to ? '不变' : '就绪';
    var color = st === '就绪' ? 'var(--ok)'
              : st === '不变' ? 'var(--tx3)'
              : st === '未识别日期' ? 'var(--warn, #d97706)'
              : 'var(--err)';
    h += '<tr><td>'+(i+1)+'</td><td class="mono">'+esc(p.from)+'</td>' +
      '<td class="muted">→</td><td class="mono" style="color:'+color+'">'+esc(p.to||'')+'</td>' +
      '<td style="color:'+color+'">'+st+'</td></tr>';
  });
  h += '</tbody></table></div>';
  box.innerHTML = h;

  var okN = preview.filter(function(p){ return p.ok && p.from !== p.to; }).length;
  var skip = preview.filter(function(p){ return !p.ok; }).length;
  setHint('将重命名 ' + okN + ' / ' + files.length + ' 个文件' +
          (skip ? ('，跳过 ' + skip + ' 个（重名／未识别日期）') : ''));
  $('rnRun').disabled = okN === 0;
  refreshUndoUi();
}

['rnMode','rnFrom','rnTo','rnPre','rnSuf','rnNumStart','rnNumPad','rnNumTpl',
 'rnDateSep','rnDateTpl','rnKeepExt','rnLowerExt'].forEach(function(id){
  var el = $(id);
  if (!el) return;
  el.addEventListener('input', function(){ syncModeRows(); buildPreview(); });
  el.addEventListener('change', function(){ syncModeRows(); buildPreview(); });
});
syncModeRows();
refreshUndoUi();

/* ---------- 执行 ---------- */
function pushUndo(mapping){
  if (!mapping.length) return;
  var at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  mapping.forEach(function(m){ logEntries.push({ from: m.from, to: m.to, op: '重命名', at: at }); });
  undoStack.push(mapping);
  if (undoStack.length > 5) undoStack.shift();
  refreshUndoUi();
}

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
      // 原地改名：先统一改成临时名，再改成目标名，避免互相覆盖
      for (var k=0;k<jobs.length;k++){
        var j = jobs[k];
        var tmp = '.rn_tmp_' + k + '_' + j.to;
        await j.file.handle.move(dirHandle, tmp);
        j.file.handle = await dirHandle.getFileHandle(tmp);
      }
      // 记录「原名 → 新名」，用于撤销与导出记录（j.file.name 仍是原名）
      var mapping = [];
      for (var k2=0;k2<jobs.length;k2++){
        var j2 = jobs[k2];
        await j2.file.handle.move(dirHandle, j2.to);
        mapping.push({ from: j2.file.name, to: j2.to });
      }
      pushUndo(mapping);
      notice('info','已在文件夹内完成 ' + jobs.length + ' 个重命名（可撤销）');
      await reloadFolder();
    } else {
      // 拖入模式：打包 ZIP，不动原文件，因此没有撤销的概念
      var zipFiles = [];
      for (var k3=0;k3<jobs.length;k3++){
        var buf = new Uint8Array(await jobs[k3].file.file.arrayBuffer());
        zipFiles.push({ name: jobs[k3].to, data: buf });
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
    refreshUndoUi();
  }
};

/* ---------- 撤销 ---------- */
$('rnUndo').onclick = async function(){
  if (!dirHandle || !undoStack.length){ notice('warn','没有可撤销的操作'); return; }
  var btn = this;
  btn.disabled = true;
  try{
    var mapping = undoStack[undoStack.length - 1];
    var staged = [];
    // 反向两阶段：新名 → 临时名 → 原名。先全部挪到临时名，再落回原名，
    // 否则 A→B、B→A 这类互换会互相踩。
    for (var i=0;i<mapping.length;i++){
      try{
        var fh = await dirHandle.getFileHandle(mapping[i].to);
        var tmp = '.rn_undo_' + i + '_' + mapping[i].from;
        await fh.move(dirHandle, tmp);
        staged.push({ handle: await dirHandle.getFileHandle(tmp), back: mapping[i].from });
      }catch(err){
        // 该文件已被移动或删除，跳过，不影响其余文件回退
      }
    }
    for (var k=0;k<staged.length;k++) await staged[k].handle.move(dirHandle, staged[k].back);
    undoStack.pop();
    var at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    mapping.forEach(function(m){ logEntries.push({ from: m.to, to: m.from, op: '撤销', at: at }); });
    notice('info','已撤销 ' + staged.length + ' 个文件的改名');
    await reloadFolder();
  }catch(e){
    notice('err','撤销失败：' + esc(e.message));
    console.error(e);
  }finally{
    refreshUndoUi();
  }
};

/* ---------- 导出改名记录 ---------- */
$('rnLog').onclick = function(){
  if (!logEntries.length){ notice('warn','还没有改名记录'); return; }
  var rows = [['原名', '新名', '操作', '时间']];
  logEntries.forEach(function(e){ rows.push([e.from, e.to, e.op, e.at || '']); });
  var csv = rows.map(function(r){
    return r.map(function(c){ return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\r\n');
  U.saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), '改名记录.csv');
  notice('info','已导出 ' + logEntries.length + ' 条记录');
};

/* 流水线：改名后接着归类 */
if ($('rnToFolder')) $('rnToFolder').onclick = function(){
  if (!dirHandle){ notice('warn','请先选择文件夹并完成改名'); return; }
  if (TB.folderorg && TB.folderorg.setHandle){
    TB.folderorg.setHandle(dirHandle, dirHandle.name);
  }
  var nav = document.querySelector('[data-tool="folder"]');
  if (nav) nav.click();
};
})();

