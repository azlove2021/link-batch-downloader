/* ============ 文件夹按规则归类 ============
 * 规则分桶/汇总/报告的纯逻辑在 js/folder-core.js（有单测）；
 * 这里负责接线 + 会话内撤销栈（最多 5 步，倒序把文件移回原文件夹）。 */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;
var FB = TB.folderCore || {};

var dirHandle = null;
var plan = []; // {name, from, to, file}
var LOGS = []; // 已执行的归类 {ts, mode, root, rootHandle, items:[{name,to,ok,undo}]}

$('foMode').onchange = function(){
  $('foKwRow').style.display = this.value === 'keyword' ? '' : 'none';
};
$('foMode').dispatchEvent(new Event('change'));

$('foBrowse').onclick = async function(){
  if (!U.FS_OK){ notice('err','请用 Chrome / Edge 才能原地归类'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'folder-organize', mode:'readwrite' });
    dirHandle = h;
    $('foPath').value = h.name + '\\';
    $('foStat').textContent = '已选择：' + h.name;
    $('foRun').disabled = true;
    plan = [];
    $('foList').innerHTML = '';
  }catch(e){
    if (e.name !== 'AbortError') notice('err','选择失败：'+esc(e.message));
  }
};
$('foClear').onclick = function(){
  dirHandle = null; plan = [];
  $('foPath').value = '';
  $('foList').innerHTML = '';
  $('foStat').textContent = '';
  $('foRun').disabled = true;
};

/* 规则分桶逻辑抽到 folder-core.js（单测盯着），这里只留引用 */
var bucketFor = FB.bucketFor;

async function buildPlan(){
  if (!dirHandle){ notice('warn','请先选择文件夹'); return null; }
  var mode = $('foMode').value;
  var kws = ($('foKw').value || '').split(/[,，]/).map(function(s){ return s.trim(); }).filter(Boolean);
  var skipTop = $('foSkipTop').checked;
  var files = [];
  for await (var entry of dirHandle.values()){
    if (entry.kind === 'directory') continue;
    if (entry.name === '使用说明.txt') continue;
    if (/^\./.test(entry.name)) continue;
    var f = await entry.getFile();
    files.push({ handle: entry, name: entry.name, size: f.size, lastModified: f.lastModified });
  }
  if (!files.length){ notice('warn','文件夹里没有文件'); return null; }
  plan = files.map(function(f){
    var to = bucketFor(f, mode, kws);
    return { name: f.name, to: to, handle: f.handle };
  }).sort(function(a,b){ return a.to.localeCompare(b.to,'zh') || a.name.localeCompare(b.name,'zh'); });
  return plan;
}

function renderPlan(){
  var box = $('foList');
  if (!plan.length){ box.innerHTML = '<div class="muted">无计划</div>'; $('foRun').disabled = true; return; }
  var groups = FB.summarizePlan(plan);
  var h = '<div class="rtable"><table><thead><tr><th>目标子文件夹</th><th>数量</th><th>示例</th></tr></thead><tbody>';
  groups.forEach(function(g){
    var sample = g.sample.join('、') + (g.count > 3 ? ' …' : '');
    h += '<tr><td class="mono">' + esc(g.key) + '</td><td>' + g.count + '</td><td class="mono">' + esc(sample) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  box.innerHTML = h;
  $('foRun').disabled = false;
  $('foStat').textContent = '将 ' + plan.length + ' 个文件归入 ' + groups.length + ' 个子文件夹';
}

$('foPreview').onclick = async function(){
  var btn = this; btn.disabled = true; btn.textContent = '扫描中…';
  try{
    var p = await buildPlan();
    if (p) renderPlan();
  }catch(e){
    notice('err', '预览失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '预览归类';
  }
};

$('foRun').onclick = async function(){
  if (!dirHandle || !plan.length){ notice('warn','请先预览'); return; }
  if (!confirm('确认按当前计划归类 ' + plan.length + ' 个文件？')) return;
  var btn = this; btn.disabled = true; btn.textContent = '归类中…';
  var ok = 0, fail = 0;
  var items = [];
  try{
    // 先建目录
    var dirs = {};
    for (var i = 0; i < plan.length; i++){
      var t = plan[i].to;
      if (!dirs[t]){
        dirs[t] = await dirHandle.getDirectoryHandle(t, { create: true });
      }
    }
    for (var i = 0; i < plan.length; i++){
      var p = plan[i];
      try{
        await p.handle.move(dirs[p.to], p.name);
        ok++;
        items.push({ name: p.name, to: p.to, ok: true });
      }catch(e){
        fail++;
        items.push({ name: p.name, to: p.to, ok: false });
      }
    }
    LOGS.push({
      ts: Date.now(),
      mode: ($('foMode').selectedOptions[0] || {}).textContent || $('foMode').value,
      root: dirHandle.name, rootHandle: dirHandle, items: items
    });
    if (LOGS.length > 5) LOGS.shift();
    updateUndoBtns();
    notice(fail ? 'warn' : 'info', '归类完成：成功 ' + ok + (fail ? '，失败 ' + fail : '') + '。可「撤销上次归类」还原。');
    $('foStat').textContent = '完成：成功 ' + ok + '，失败 ' + fail;
    plan = [];
    $('foList').innerHTML = '<div class="muted">已执行。可「撤销上次归类」还原，或重新「预览归类」查看结果。</div>';
    $('foRun').disabled = true;
  }catch(e){
    notice('err', '归类失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '执行归类';
  }
};

/* ---------- 撤销上次归类 / 导出归类记录（处理报告） ---------- */
function updateUndoBtns(){
  $('foUndo').disabled = !LOGS.length;
  $('foExpLog').disabled = !LOGS.length;
}
$('foUndo').onclick = async function(){
  if (!LOGS.length){ notice('info','没有可撤销的归类。'); return; }
  var log = LOGS[LOGS.length - 1];
  if (!log.rootHandle){
    notice('warn','原文件夹句柄已失效，无法自动撤销；可「导出归类记录」按 CSV 手动还原。');
    return;
  }
  if (!confirm('把最近一次归类（' + log.items.length + ' 个文件，规则：' + log.mode + '）移回「' + log.root + '」根目录？')) return;
  var btn = this; btn.disabled = true; btn.textContent = '撤销中…';
  var back = 0, miss = 0;
  try{
    for (var i = log.items.length - 1; i >= 0; i--){   /* 倒序回放 */
      var it = log.items[i];
      if (!it.ok || it.undo) continue;
      try{
        var sub = await log.rootHandle.getDirectoryHandle(it.to);
        var fh = await sub.getFileHandle(it.name);
        await fh.move(log.rootHandle, it.name);
        it.undo = true; back++;
      }catch(e){ miss++; }
    }
    /* 搬空的子文件夹顺手删掉（目录非空时 removeDirectory 会自动失败，忽略即可） */
    var emptied = {};
    log.items.forEach(function(it){ if (it.undo) emptied[it.to] = 1; });
    for (var d in emptied){ try{ await log.rootHandle.removeDirectory(d); }catch(e){ /* 非空/不存在 */ } }
    LOGS.pop();
    updateUndoBtns();
    notice(miss ? 'warn' : 'info', '已撤销：移回 ' + back + ' 个文件' + (miss ? '，' + miss + ' 个未找到（可能已被再次移动或改名）' : '') + '。');
    $('foStat').textContent = '已撤销上次归类（移回 ' + back + ' 个）';
  }catch(e){
    notice('err','撤销失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '撤销上次归类';
  }
};
$('foExpLog').onclick = function(){
  var rows = FB.reportRows ? FB.reportRows(LOGS) : [];
  if (!rows.length){ notice('info','本次会话还没有归类记录。'); return; }
  var csv = U.toCsv([['时间','规则','根文件夹','文件名','归入','状态']].concat(rows));
  U.saveBlob(new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'}), '归类记录.csv');
  notice('info','已导出 归类记录.csv（' + rows.length + ' 行）');
};
})();
