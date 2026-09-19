/* ============ 重复文件查找（UI 层） ============
 * 扫描：递归遍历文件夹（跳过隐藏文件）。
 * 内容重复：大小分组 → 前 64KB 快筛哈希 → 全量 SHA-256，两级过滤省时间。
 * 处置：只移动不删除 —— 副本移入「_重复文件/组N/」，可一键撤销还原。
 * 纯逻辑（分组/保留选择/相似配对）在 js/dup-core.js。
 */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc, fmtSize = U.fmtSize;
var DPC = TB.dupCore || {};

var rootHandle = null;
var rootB = null;          // 目录对比的 B 文件夹
var FILES = [];         // {handle, parent, path, name, size, lastModified, file, moved?}
var contentGroups = []; // [{hash, size, items:[file...], keeper}]
var namePairs = [];     // [{a, b, score}]
var abResult = null;    // {onlyA, onlyB, diff}
var movedLog = null;    // {base, items:[{sub, name, parent, fromName}]}

function updateBtns(){
  var abMode = $('dfModeAb') && $('dfModeAb').checked;
  $('dfScan').disabled = abMode ? !(rootHandle && rootB) : !rootHandle;
  var hasResult = contentGroups.length > 0 || namePairs.length > 0 || abResult;
  $('dfExpCsv').disabled = !hasResult;
  var dupCount = contentGroups.reduce(function(n,g){ return n + g.items.length - 1; }, 0);
  $('dfQuarantine').disabled = !dupCount || !rootHandle || !!abMode;
  $('dfUndo').disabled = !movedLog;
}

$('dfModeAb').onchange = function(){
  $('dfPathBRow').style.display = this.checked ? '' : 'none';
  updateBtns();
};

$('dfBrowseB').onclick = async function(){
  if (!U.FS_OK){ notice('err','请用 Chrome / Edge'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'dup-find-b', mode:'read' });
    rootB = h;
    $('dfPathB').value = h.name + '\\';
    updateBtns();
    notice('info','已选对比文件夹 B：' + h.name);
  }catch(e){ if (e.name !== 'AbortError') notice('err','选择失败：'+esc(e.message)); }
};

$('dfBrowse').onclick = async function(){
  if (!U.FS_OK){ notice('err','请用 Chrome / Edge（需要本地文件夹读写）。'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'dup-find', mode:'readwrite' });
    rootHandle = h;
    $('dfPath').value = h.name + '\\';
    FILES = []; contentGroups = []; namePairs = []; movedLog = null; abResult = null;
    $('dfList').innerHTML = '';
    $('dfStat').textContent = '已选择：' + h.name;
    updateBtns();
  }catch(e){ if (e.name !== 'AbortError') notice('err','选择失败：'+esc(e.message)); }
};
$('dfClear').onclick = function(){
  rootHandle = null; rootB = null; FILES = []; contentGroups = []; namePairs = []; movedLog = null; abResult = null;
  $('dfPath').value = ''; if ($('dfPathB')) $('dfPathB').value = '';
  $('dfList').innerHTML = ''; $('dfStat').textContent = '';
  updateBtns();
};

async function walk(dir, prefix, onFile){
  for await (var entry of dir.values()){
    if (/^\./.test(entry.name)) continue;
    var p = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'directory'){
      await walk(entry, p, onFile);
    } else {
      var f = await entry.getFile();
      onFile({ handle: entry, parent: dir, path: p, name: entry.name,
               size: f.size, lastModified: f.lastModified, file: f });
    }
  }
}

$('dfScan').onclick = async function(){
  if (!rootHandle){ notice('warn','请先选择文件夹'); return; }
  var wantContent = $('dfModeContent').checked, wantName = $('dfModeName').checked;
  var wantAb = $('dfModeAb') && $('dfModeAb').checked;
  if (wantAb){
    if (!rootB){ notice('warn','目录对比需要选择文件夹 B'); return; }
  } else if (!wantContent && !wantName){ notice('warn','至少勾选一种查找方式'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '扫描中…';
  var t0 = Date.now();
  try{
    FILES = []; contentGroups = []; namePairs = []; abResult = null;
    await walk(rootHandle, '', function(f){
      FILES.push(f);
      if (FILES.length % 200 === 0) btn.textContent = '已发现 ' + FILES.length + ' 个文件…';
    });
    if (wantAb){
      var filesB = [];
      await walk(rootB, '', function(f){ filesB.push(f); });
      var mapA = Object.create(null), mapB = Object.create(null);
      FILES.forEach(function(f){ mapA[f.path.toLowerCase()] = f; });
      filesB.forEach(function(f){ mapB[f.path.toLowerCase()] = f; });
      var onlyA = [], onlyB = [], diff = [];
      Object.keys(mapA).forEach(function(k){
        var a = mapA[k], b = mapB[k];
        if (!b){ onlyA.push(a); return; }
        if (a.size !== b.size) diff.push({ a:a, b:b, why:'大小不同 ' + a.size + ' vs ' + b.size });
      });
      Object.keys(mapB).forEach(function(k){
        if (!mapA[k]) onlyB.push(mapB[k]);
      });
      abResult = { onlyA: onlyA, onlyB: onlyB, diff: diff, nameA: rootHandle.name, nameB: rootB.name };
      renderAb();
      $('dfStat').textContent = 'A ' + FILES.length + ' 个 · B ' + filesB.length + ' 个 · 只在A ' + onlyA.length + ' · 只在B ' + onlyB.length + ' · 同名异内容 ' + diff.length;
      notice('info','目录对比完成：只在A '+onlyA.length+' · 只在B '+onlyB.length+' · 同名异内容 '+diff.length);
    } else {
      if (wantContent) await findContentDups(btn);
      if (wantName) findNameDups();
      render();
      var dupCount = contentGroups.reduce(function(n,g){ return n + g.items.length - 1; }, 0);
      var waste = contentGroups.reduce(function(n,g){ return n + g.size * (g.items.length - 1); }, 0);
      $('dfStat').textContent = '共 ' + FILES.length + ' 个文件 · 用时 ' + ((Date.now()-t0)/1000).toFixed(1) + 's';
      notice('info', '扫描完成：' + FILES.length + ' 个文件' +
        (wantContent ? '，内容重复 ' + contentGroups.length + ' 组（多余副本 ' + dupCount + ' 个，占 ' + fmtSize(waste) + '）' : '') +
        (wantName ? '，相似文件名 ' + namePairs.length + ' 对' : ''));
    }
    if (U.oplog) U.oplog.add(wantAb ? '目录差异' : '重复文件扫描',
      wantAb ? (rootHandle.name + ' ↔ ' + rootB.name) : ('A=' + FILES.length));
  }catch(e){
    notice('err','扫描失败：'+esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '开始扫描';
    updateBtns();
  }
};

function renderAb(){
  if (!abResult){ return; }
  var h = '<div class="rtable"><table><thead><tr><th>情况</th><th>文件</th><th>大小</th></tr></thead><tbody>';
  function rows(list, tag, cls){
    var n = Math.min(list.length, 40);
    for (var i=0;i<n;i++){
      var f = list[i];
      h += '<tr><td>'+tag+'</td><td class="mono">'+esc(f.path)+'</td><td>'+fmtSize(f.size)+'</td></tr>';
    }
    if (list.length > n) h += '<tr><td colspan="3" class="muted">…其余 '+(list.length-n)+' 条见导出</td></tr>';
  }
  h += '<tr><td colspan="3" class="muted" style="background:#fafbfd">只在 A（'+abResult.nameA+'）：'+abResult.onlyA.length+'</td></tr>';
  rows(abResult.onlyA, '仅A');
  h += '<tr><td colspan="3" class="muted" style="background:#fafbfd">只在 B（'+abResult.nameB+'）：'+abResult.onlyB.length+'</td></tr>';
  rows(abResult.onlyB, '仅B');
  h += '<tr><td colspan="3" class="muted" style="background:#fafbfd">同名但大小不同：'+abResult.diff.length+'</td></tr>';
  var nd = Math.min(abResult.diff.length, 40);
  for (var i=0;i<nd;i++){
    var d = abResult.diff[i];
    h += '<tr><td>异</td><td class="mono">'+esc(d.a.path)+'<br><span class="muted">'+esc(d.why)+'</span></td><td></td></tr>';
  }
  h += '</tbody></table></div>';
  $('dfList').innerHTML = h;
}

async function findContentDups(btn){
  var sizeGroups = DPC.groupBySize(FILES);
  var candidates = sizeGroups.reduce(function(n,g){ return n + g.length; }, 0);
  if (!candidates) return;
  var done = 0, groups = [];
  btn.textContent = '大小分组 ' + candidates + ' 个待哈希…';
  for (var gi = 0; gi < sizeGroups.length; gi++){
    var idxs = sizeGroups[gi];
    /* 第一层：前 64KB 快筛（大文件不用全读） */
    var byQuick = {};
    for (var k = 0; k < idxs.length; k++){
      var f = FILES[idxs[k]];
      var qh = await U.sha256Of(f.file.slice(0, 65536));
      (byQuick[qh] = byQuick[qh] || []).push(idxs[k]);
      if (++done % 50 === 0) btn.textContent = '快筛哈希 ' + done + '/' + candidates + ' …';
    }
    /* 第二层：全量 SHA-256（只算快筛撞上的） */
    for (var qk in byQuick){
      var sub = byQuick[qk];
      if (sub.length < 2) continue;
      var byFull = {};
      for (var m = 0; m < sub.length; m++){
        var fh = await U.sha256Of(FILES[sub[m]].file);
        (byFull[fh] = byFull[fh] || []).push(sub[m]);
        if (++done % 50 === 0) btn.textContent = '全量哈希 ' + done + '/' + (candidates * 2) + ' …';
      }
      for (var fk in byFull){
        if (byFull[fk].length >= 2){
          var items = byFull[fk].map(function(i){ return FILES[i]; });
          groups.push({ hash: fk, size: items[0].size, items: items, keeper: DPC.pickKeeper(items) });
        }
      }
    }
  }
  /* 浪费空间多的组排前面 */
  contentGroups = groups.sort(function(a,b){ return b.size*(b.items.length-1) - a.size*(a.items.length-1); });
}

function findNameDups(){
  var th = parseFloat($('dfThreshold').value);
  if (!(th > 0 && th <= 1)) th = 0.88;
  namePairs = DPC.similarNamePairs(FILES, { threshold: th, window: 10 });
}

function render(){
  var h = '';
  if (contentGroups.length){
    h += '<h3 style="margin:6px 0">内容完全重复（' + contentGroups.length + ' 组）</h3>';
    contentGroups.forEach(function(g, gi){
      h += '<div class="card" style="margin-bottom:8px"><div class="card-b" style="padding:8px 10px">' +
           '<div class="mono muted">组 ' + (gi+1) + ' · 每个 ' + fmtSize(g.size) + ' · SHA-256 ' + g.hash.slice(0,12) + '…</div>';
      g.items.forEach(function(f, fi){
        h += '<div class="mono" style="padding:2px 0 2px 10px">' +
             (fi === g.keeper
               ? '<b title="保留这个（层级最浅/路径最短）">✓ 保留</b> '
               : '<span style="color:var(--err)">✗ 副本</span> ') +
             esc(f.path) + (f.moved ? ' <span class="muted">（已移入 _重复文件）</span>' : '') + '</div>';
      });
      h += '</div></div>';
    });
  }
  if (namePairs.length){
    h += '<h3 style="margin:10px 0 6px">文件名相似（' + namePairs.length + ' 对）</h3>' +
         '<div class="rtable"><table><thead><tr><th>文件 A</th><th>文件 B</th><th>相似度</th></tr></thead><tbody>';
    namePairs.slice(0, 500).forEach(function(p){
      h += '<tr><td class="mono">' + esc(FILES[p.a].path) + '</td><td class="mono">' + esc(FILES[p.b].path) +
           '</td><td>' + (p.score * 100).toFixed(0) + '%</td></tr>';
    });
    h += '</tbody></table></div>' +
         (namePairs.length > 500 ? '<div class="muted">仅显示前 500 对，完整清单请导出 CSV</div>' : '');
  }
  if (!h) h = '<div class="muted">没有发现重复。</div>';
  $('dfList').innerHTML = h;
}

/* ---------- 隔离（只移动不删除）与撤销 ---------- */
$('dfQuarantine').onclick = async function(){
  if (!rootHandle || !contentGroups.length) return;
  var moves = [];
  contentGroups.forEach(function(g, gi){
    g.items.forEach(function(f, fi){
      if (fi !== g.keeper && !f.moved) moves.push({ f: f, group: '组' + (gi + 1) });
    });
  });
  if (!moves.length){ notice('info','没有可移动的副本。'); return; }
  if (!confirm('把 ' + moves.length + ' 个重复副本移入「_重复文件」子文件夹（按组分目录，不删除，可撤销）？')) return;
  var btn = this; btn.disabled = true; btn.textContent = '移动中…';
  var ok = 0, fail = 0, items = [];
  try{
    var base = await rootHandle.getDirectoryHandle('_重复文件', { create: true });
    for (var i = 0; i < moves.length; i++){
      var m = moves[i];
      try{
        var sub = await base.getDirectoryHandle(m.group, { create: true });
        /* 目标同名冲突时自动加序号 */
        var target = m.f.name, n = 1;
        while (true){
          try{ await sub.getFileHandle(target); target = m.f.name.replace(/(\.[^.]+)?$/, '_' + (++n) + '$1'); }
          catch(e){ break; }
        }
        await m.f.handle.move(sub, target);
        m.f.moved = true;
        ok++;
        items.push({ sub: sub, subName: m.group, name: target, parent: m.f.parent, fromName: m.f.name });
      }catch(e){ fail++; }
    }
    movedLog = { base: base, items: items };
    notice(fail ? 'warn' : 'info', '已移入 _重复文件：' + ok + ' 个' + (fail ? '，失败 ' + fail : '') + '。可「撤销移动」还原。');
    render();
  }catch(e){
    notice('err','移动失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '移入 _重复文件';
    updateBtns();
  }
};

$('dfUndo').onclick = async function(){
  if (!movedLog){ notice('info','没有可撤销的移动。'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '还原中…';
  var back = 0, miss = 0;
  try{
    var touchedSubs = {};   /* 记组名（不能拿 handle 当对象键，会被字符串化成 [object Object]） */
    for (var i = movedLog.items.length - 1; i >= 0; i--){
      var it = movedLog.items[i];
      touchedSubs[it.subName] = 1;
      try{
        var fh = await it.sub.getFileHandle(it.name);
        await fh.move(it.parent, it.fromName);
        back++;
      }catch(e){ miss++; }
    }
    /* 清掉搬空的组目录与 _重复文件 根目录（非空会自动失败，忽略） */
    for (var s in touchedSubs){ try{ await movedLog.base.removeDirectory(s); }catch(e){} }
    try{ await rootHandle.removeDirectory('_重复文件'); }catch(e){}
    FILES.forEach(function(f){ if (f.moved) delete f.moved; });
    movedLog = null;
    notice(miss ? 'warn' : 'info', '已还原 ' + back + ' 个文件' + (miss ? '，' + miss + ' 个未找到（可能已被手动移动）' : '') + '。');
    render();
  }catch(e){
    notice('err','还原失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '撤销移动';
    updateBtns();
  }
};

/* ---------- 导出清单 CSV ---------- */
$('dfExpCsv').onclick = function(){
  var rows = [['类型','组/对','处置','路径','大小(字节)','SHA-256','相似度']];
  contentGroups.forEach(function(g, gi){
    g.items.forEach(function(f, fi){
      rows.push(['内容重复', '组' + (gi+1),
                 fi === g.keeper ? '保留' : (f.moved ? '副本(已移入_重复文件)' : '副本'),
                 f.path, f.size, g.hash, '']);
    });
  });
  namePairs.forEach(function(p, pi){
    rows.push(['相似文件名', '对' + (pi+1), 'A', FILES[p.a].path, FILES[p.a].size, '', (p.score*100).toFixed(1) + '%']);
    rows.push(['相似文件名', '对' + (pi+1), 'B', FILES[p.b].path, FILES[p.b].size, '', (p.score*100).toFixed(1) + '%']);
  });
  if (abResult){
    abResult.onlyA.forEach(function(f){ rows.push(['目录差异','仅A','—', f.path, f.size, '', '']); });
    abResult.onlyB.forEach(function(f){ rows.push(['目录差异','仅B','—', f.path, f.size, '', '']); });
    abResult.diff.forEach(function(d){
      rows.push(['目录差异','同名异内容', d.why, d.a.path, d.a.size, '', '']);
    });
  }
  if (rows.length < 2){ notice('info','没有结果可导出。'); return; }
  var csv = U.toCsv(rows);
  U.saveBlob(new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'}), '重复文件清单.csv');
  notice('info','已导出 重复文件清单.csv（' + (rows.length - 1) + ' 行）');
};
})();
