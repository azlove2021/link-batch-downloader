/* ============ 文件夹按规则归类 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

var dirHandle = null;
var plan = []; // {name, from, to, file}

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

function bucketFor(file, mode, kws){
  var name = file.name;
  var ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase() || '无扩展名';
  if (mode === 'ext') return ext.replace('.', '') || '无扩展名';
  if (mode === 'yearmonth' || mode === 'year'){
    var d = file.lastModified ? new Date(file.lastModified) : null;
    if (!d) return '未知日期';
    var y = d.getFullYear();
    if (mode === 'year') return String(y);
    return y + '-' + ('0' + (d.getMonth()+1)).slice(-2);
  }
  if (mode === 'keyword'){
    var lower = name.toLowerCase();
    for (var i = 0; i < kws.length; i++){
      if (kws[i] && lower.indexOf(kws[i].toLowerCase()) >= 0) return kws[i];
    }
    return '其他';
  }
  if (mode === 'prefix') return name.slice(0, 2) || '其他';
  if (mode === 'size'){
    var mb = (file.size || 0) / (1024*1024);
    if (mb < 0.1) return '<100KB';
    if (mb < 1) return '100KB-1MB';
    if (mb < 10) return '1-10MB';
    if (mb < 100) return '10-100MB';
    return '>=100MB';
  }
  return '其他';
}

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
  var groups = {};
  plan.forEach(function(p){
    if (!groups[p.to]) groups[p.to] = [];
    groups[p.to].push(p);
  });
  var keys = Object.keys(groups).sort();
  var h = '<div class="rtable"><table><thead><tr><th>目标子文件夹</th><th>数量</th><th>示例</th></tr></thead><tbody>';
  keys.forEach(function(k){
    var arr = groups[k];
    var sample = arr.slice(0, 3).map(function(x){ return x.name; }).join('、') + (arr.length > 3 ? ' …' : '');
    h += '<tr><td class="mono">' + esc(k) + '</td><td>' + arr.length + '</td><td class="mono" title="' + esc(arr[0].name) + '">' + esc(sample) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  box.innerHTML = h;
  $('foRun').disabled = false;
  $('foStat').textContent = '将 ' + plan.length + ' 个文件归入 ' + keys.length + ' 个子文件夹';
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
      }catch(e){
        fail++;
      }
    }
    notice(fail ? 'warn' : 'info', '归类完成：成功 ' + ok + (fail ? '，失败 ' + fail : ''));
    $('foStat').textContent = '完成：成功 ' + ok + '，失败 ' + fail;
    plan = [];
    $('foList').innerHTML = '<div class="muted">已执行。可重新「预览归类」查看结果。</div>';
    $('foRun').disabled = true;
  }catch(e){
    notice('err', '归类失败：' + esc(e.message||e));
  }finally{
    btn.disabled = false; btn.textContent = '执行归类';
  }
};
})();
