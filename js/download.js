/* ============ 批量下载（迁移自原版，适配工具箱） ============ */
'use strict';

(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc, fmtSize = U.fmtSize,
    fmtSpeed = U.fmtSpeed, fmtEta = U.fmtEta, safeName = U.safeName;
var DC = TB.downloadCore || {};   /* 纯函数核心：js/download-core.js（请求头解析 / 失败清单） */

/* 自定义请求头 + 登录 Cookie → fetch 选项。
 * 浏览器禁止手动设置 Cookie / Referer / User-Agent 等头，parseHeaders 已拦截；
 * 写了 Cookie 头或勾了「携带登录 Cookie」时改用 credentials 模式
 * （发送浏览器里该站点已有的 cookie，自定义 Cookie 值浏览器发不出去）。 */
function customHeaderInfo(){
  var el = $('optHeaders');
  if(DC.parseHeaders) return DC.parseHeaders(el ? el.value : '');
  return { headers:{}, forbidden:[], cookieWanted:false };
}
function fetchOpts(extraHeaders, signal){
  var info = customHeaderInfo();
  var h = {};
  Object.keys(info.headers).forEach(function(k){ h[k] = info.headers[k]; });
  if(extraHeaders) Object.keys(extraHeaders).forEach(function(k){ h[k] = extraHeaders[k]; });
  var opts = { headers: h };
  if(signal) opts.signal = signal;
  if($('optCreds').checked || info.cookieWanted) opts.credentials = 'include';
  return opts;
}
function warnForbiddenHeaders(){
  var info = customHeaderInfo();
  if(!info.forbidden.length) return;
  if(S.nativeMode){
    notice('info','原生下载通道：' + esc(info.forbidden.map(function(f){ return f.name; }).join('、')) + ' 等头会原样发送（Rust 端无浏览器限制）。');
    return;
  }
  notice('warn','这些请求头被浏览器禁止、已忽略：<b>' +
    esc(info.forbidden.map(function(f){ return f.name; }).join('、')) + '</b>' +
    (info.cookieWanted ? '（Cookie 已自动转为「携带登录 Cookie」模式：发送浏览器里该站点已有的 cookie）' : '') +
    '。桌面版可勾「原生下载通道」让禁止头真正生效。');
}

var MIME_EXT = {
  'application/pdf':'.pdf','video/mp4':'.mp4','image/jpeg':'.jpg','image/png':'.png',
  'image/gif':'.gif','image/webp':'.webp','application/zip':'.zip','application/x-zip-compressed':'.zip',
  'application/msword':'.doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
  'application/vnd.ms-excel':'.xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx',
  'application/vnd.ms-powerpoint':'.ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx',
  'text/plain':'.txt','text/html':'.html','application/json':'.json','application/x-rar-compressed':'.rar',
  'application/x-7z-compressed':'.7z','audio/mpeg':'.mp3','video/x-msvideo':'.avi','video/quicktime':'.mov'
};
function extFromMime(ct){
  if(!ct) return '';
  ct = ct.split(';')[0].trim().toLowerCase();
  return MIME_EXT[ct] || '';
}

var ORD_RE = /^\s*(?:\d+\s*[.、)）]\s*|[-*•·]\s*|\[\d+\]\s*|\(\d+\)\s*)?/;
function stripOrdinal(s){
  return s.replace(ORD_RE,'').replace(/^[\s:：\-—]+|[\s:：\-—]+$/g,'').trim();
}
function extractUrl(line){
  var i = line.search(/https?:\/\//i);
  if(i < 0) return null;
  var url = line.slice(i).trim();
  url = url.replace(/[)"'）】>」』\]]+$/,'');
  if(/[)\]】]$/.test(url) && (url.split('(').length < url.split(')').length)) url = url.slice(0,-1);
  return url;
}
function parseTxt(text){
  var out = [], seen = Object.create(null), lastTitle = '';
  var lines = text.split(/\r?\n/);
  for(var k=0;k<lines.length;k++){
    var line = lines[k].trim();
    if(!line) continue;
    var url = extractUrl(line);
    if(!url){
      if(!/^[-=_*#·]{3,}$/.test(line) && !/^第?\s*\d+\s*页/.test(line)) lastTitle = stripOrdinal(line);
      continue;
    }
    var pre = line.slice(0, line.search(/https?:\/\//i)).trim();
    var title = '';
    if(pre){
      var mm = pre.match(/\[([^\]]*)\]\s*\(?\s*$/);
      title = mm ? mm[1].trim() : stripOrdinal(pre);
    }
    if(!title) title = lastTitle;
    lastTitle = '';
    var key = url.toLowerCase();
    if(seen[key]) continue;
    seen[key] = 1;
    out.push({ url:url, title:title });
  }
  return out;
}
function urlBaseName(url){
  try{
    var p = new URL(url).pathname;
    var b = p.split('/').pop() || '';
    try{ b = decodeURIComponent(b); }catch(e){}
    return b;
  }catch(e){
    var m = url.split('?')[0].split('/').pop();
    try{ return decodeURIComponent(m); }catch(e2){ return m; }
  }
}
function guessName(item){
  var base = urlBaseName(item.url);
  var ext = (base.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
  if(item.title){
    var t = safeName(item.title);
    if(t){
      if(/\.[A-Za-z0-9]{1,8}$/.test(t)) return t;
      return t + (ext || '.download');
    }
  }
  return base ? safeName(base) : ('file_' + Math.random().toString(36).slice(2,8));
}

var S = {
  rootHandle:null, rootPath:'',
  outHandle:null, outPath:'', outIsDefault:true,
  groups:[], running:false, paused:false, abort:null, stopAll:false,
  bytes:0, startedAt:0, lastBytes:0, lastTs:0, speed:0,
  nativeMode:false, nativeOut:''   /* 桌面原生下载通道（Rust）：输出用真实路径 */
};
var TASKS = [];
window.TASKS = TASKS;
var MS = { active:false, moved:false, dragMode:'', dragGroup:null, dragStartIdx:-1, anchor:null };
window.MS = MS;

function resetStats(){
  S.bytes = 0; S.startedAt = 0; S.lastBytes = 0; S.lastTs = 0; S.speed = 0;
}

/* ---------- 目录选择 ---------- */
$('btnBrowse').onclick = async function(){
  if(!U.FS_OK){ notice('err','浏览器不支持，请改用 Chrome / Edge。'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'dl-root', mode:'readwrite' });
    S.rootHandle = h;
    S.rootPath = h.name;
    $('path').value = h.name + '\\';
    $('n1').classList.add('off');
    if(S.outIsDefault){ resetOutDir(); } else { renderOutPath(); }
    autoScanIfRestored();
  }catch(e){
    if(e.name !== 'AbortError') notice('err','选择文件夹失败：' + esc(e.message));
  }
};
$('btnBrowseOut').onclick = async function(){
  if(!U.FS_OK){ notice('err','浏览器不支持，请改用 Chrome / Edge。'); return; }
  if(!S.rootHandle){ notice('warn','请先选源文件夹。'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'dl-out-' + Date.now(), mode:'readwrite' });
    S.outHandle = h;
    S.outIsDefault = false;
    renderOutPath();
    notice('info','下载目录已设置：' + h.name + '。请重新扫描以应用。');
  }catch(e){
    if(e.name !== 'AbortError') notice('err','选择下载目录失败：' + esc(e.message));
  }
};
$('btnResetOut').onclick = function(){
  resetOutDir();
  notice('info','下载目录已恢复默认（= 源文件夹）。');
};
function resetOutDir(){
  S.outHandle = S.rootHandle;
  S.outIsDefault = true;
  renderOutPath();
}
function renderOutPath(){
  var el = $('pathOut');
  if(!S.outHandle){ el.value = ''; el.placeholder = '默认 = 源文件夹下自动建子目录'; return; }
  el.value = S.outHandle.name + '\\<各txt同名子目录>';
}
async function autoScanIfRestored(){
  if(!S.rootHandle) return;
  try{
    var perm = await S.rootHandle.queryPermission({mode:'readwrite'});
    if(perm === 'granted') scan();
  }catch(e){}
}

$('btnScan').onclick = function(){
  if(!S.rootHandle){ notice('warn','请先点「浏览…」选择文件夹。'); return; }
  scan();
};

async function scan(){
  if(S.running){ notice('warn','正在下载中，请先停止。'); return; }
  var btn = $('btnScan');
  btn.disabled = true; btn.textContent = '扫描中…';
  try{
    var perm = await S.rootHandle.requestPermission({mode:'readwrite'});
    if(perm !== 'granted'){ notice('err','没有文件夹访问权限。'); return; }

    var recursive = $('optSub').checked;
    var groups = [];
    await walk(S.rootHandle, '', recursive, groups);

    S.groups = groups;
    TASKS.length = 0;
    groups.forEach(function(g){
      g.tasks.forEach(function(t){ TASKS.push(t); });
    });
    resetStats();
    render();
    if(!groups.length){
      notice('warn','没找到任何 txt 文件。' + (recursive?'':'试试勾选「包含子文件夹」。'));
    }else{
      notice('info','扫描完成：'+groups.length+' 个 txt 文件，共 '+TASKS.length+' 条链接。');
    }
  }catch(e){
    notice('err','扫描出错：' + esc(e.message));
  }finally{
    btn.disabled = false; btn.textContent = '扫描链接';
  }
}

async function walk(dirHandle, prefix, recursive, groups){
  var txts = [], subs = [];
  for await (var [name, h] of dirHandle.entries()){
    if(h.kind === 'file'){
      if(/\.txt$/i.test(name)) txts.push([name, h]);
    }else if(h.kind === 'directory'){
      if(name.charAt(0) === '.') continue;
      subs.push([name, h]);
    }
  }
  txts.sort(function(a,b){ return a[0].localeCompare(b[0],'zh'); });

  for(var i=0;i<txts.length;i++){
    var nm = txts[i][0], fh = txts[i][1];
    var text = await (await fh.getFile()).text();
    var items = parseTxt(text);
    if(!items.length) continue;
    var used = Object.create(null);
    var tasks = items.map(function(it, idx){
      var fn = dedup(guessName(it), used);
      return {
        id: 't' + (TASKS.length + idx) + '_' + Math.random().toString(36).slice(2,7),
        title: it.title || '', url: it.url, filename: fn,
        total:0, loaded:0, status:'wait', err:'', sel:true, el:null, group:null
      };
    });
    var g = {
      name: nm,
      path: prefix ? prefix + '\\' + nm : nm,
      dirHandle: dirHandle,
      outName: nm.replace(/\.txt$/i,''),
      tasks: tasks,
      collapsed: false
    };
    tasks.forEach(function(t){ t.group = g; });
    groups.push(g);
  }

  if(recursive){
    for(var j=0;j<subs.length;j++){
      try{ await walk(subs[j][1], prefix ? prefix+'\\'+subs[j][0] : subs[j][0], recursive, groups); }
      catch(e){}
    }
  }
}
function dedup(name, used){
  if(!used[name]){ used[name] = 1; return name; }
  var dot = name.lastIndexOf('.');
  var stem = dot > 0 ? name.slice(0,dot) : name;
  var ext  = dot > 0 ? name.slice(dot) : '';
  var i = 2;
  while(used[stem + ' (' + i + ')' + ext]) i++;
  var n = stem + ' (' + i + ')' + ext;
  used[n] = 1;
  return n;
}

/* ---------- 渲染 ---------- */
function render(){
  var has = S.groups.length > 0;
  $('card2').style.display = has ? '' : 'none';
  $('cardEmpty').style.display = has ? 'none' : '';
  if(!has) return;

  var totalFiles = S.groups.length, totalLinks = TASKS.length;
  $('tip2').textContent = totalFiles + ' 个文件 · ' + totalLinks + ' 条链接';
  $('n2').classList.add('off');

  var box = $('list');
  box.innerHTML = '';
  S.groups.forEach(function(g, gi){
    var d = document.createElement('div');
    d.className = 'grp';
    d.innerHTML =
      '<div class="grp-h" data-gi="'+gi+'">' +
        '<span class="arw">&#9660;</span>' +
        '<span class="nm">'+esc(g.name)+'</span>' +
        '<span class="to">→ '+esc(g.outName)+'\\</span>' +
        '<span class="cnt"><span class="mini"><i></i></span><span class="ct">0/'+g.tasks.length+'</span></span>' +
      '</div>';
    g.el = d;
    g.hd = d.querySelector('.grp-h');
    g.mini = d.querySelector('.mini i');
    g.ct = d.querySelector('.ct');
    g.hd.onclick = function(ev){
      var t = ev.target;
      while(t && t !== g.hd){
        if(t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
        t = t.parentNode;
      }
      g.collapsed = !g.collapsed;
      d.classList.toggle('cl', g.collapsed);
      g.hd.classList.toggle('cl', g.collapsed);
    };
    g.tasks.forEach(function(t, ti){
      var r = document.createElement('div');
      r.className = 'tk';
      r.dataset.tid = t.id;
      r.dataset.gi = gi;
      r.dataset.ti = ti;
      r.innerHTML =
        '<input type="checkbox" checked>' +
        '<span class="nm">'+(t.title ? '<span class="t">'+esc(t.title.slice(0,40))+'</span>' : '')+esc(t.filename)+'</span>' +
        '<span class="sz"></span>' +
        '<span class="pb"><i></i></span>' +
        '<span class="pct"></span>' +
        '<span class="st wait">等待</span>';
      var cb = r.querySelector('input');
      cb.addEventListener('mousedown', function(ev){
        if(ev.button !== 0) return;
        ev.preventDefault();
        var shift = !!ev.shiftKey;
        var target = !cb.checked;
        cb.checked = target;
        if(shift){
          var anchor = MS.anchor;
          if(anchor == null){
            t.sel = target; MS.anchor = ti;
          }else{
            var lo = Math.min(anchor, ti), hi = Math.max(anchor, ti);
            for(var k=lo;k<=hi;k++){
              var tt = g.tasks[k];
              tt.sel = target;
              if(tt.cb) tt.cb.checked = target;
            }
          }
        }else{
          t.sel = target; MS.anchor = ti;
        }
        updateSummary(true);
      });
      cb.onclick = function(ev){ ev.stopPropagation(); ev.preventDefault(); };
      r.addEventListener('mousedown', function(ev){
        if(ev.button !== 0) return;
        if(ev.target.tagName === 'INPUT') return;
        var ti2 = parseInt(r.dataset.ti, 10);
        MS.active = true;
        MS.dragMode = cb.checked ? 'uncheck' : 'check';
        MS.dragGroup = g;
        MS.dragStartIdx = ti2;
        MS.moved = false;
        ev.preventDefault();
      });
      r.addEventListener('mouseover', function(ev){
        if(!MS.active) return;
        if(MS.dragGroup !== g) return;
        MS.moved = true;
        var ti2 = parseInt(r.dataset.ti, 10);
        var lo = Math.min(MS.dragStartIdx, ti2), hi = Math.max(MS.dragStartIdx, ti2);
        for(var k=lo;k<=hi;k++){
          var tt = g.tasks[k];
          var want = MS.dragMode === 'check';
          if(tt.sel !== want){
            tt.sel = want;
            if(tt.cb) tt.cb.checked = want;
          }
        }
      });
      t.el = r; t.elSz = r.querySelector('.sz'); t.elBar = r.querySelector('.pb i');
      t.elPct = r.querySelector('.pct'); t.elSt = r.querySelector('.st'); t.cb = cb;
      d.appendChild(r);
    });
    g.elBox = d;
    box.appendChild(d);
  });

  box.addEventListener('mouseup', function(ev){
    if(!MS.active) return;
    if(!MS.moved){
      var g2 = MS.dragGroup;
      var t2 = g2.tasks[MS.dragStartIdx];
      if(t2 && t2.cb){
        t2.cb.checked = !t2.cb.checked;
        t2.sel = t2.cb.checked;
      }
    }
    MS.active = false; MS.moved = false; MS.dragMode = '';
    MS.dragGroup = null; MS.dragStartIdx = -1;
    updateSummary(true);
  });
  box.addEventListener('mouseleave', function(){
    if(MS.active){
      MS.active = false; MS.moved = false; MS.dragMode = '';
      MS.dragGroup = null; MS.dragStartIdx = -1;
    }
  });
  updateSummary();
}

var ST_TEXT = {wait:'等待', run:'下载中', ok:'完成', fail:'失败', skip:'跳过', pause:'已暂停'};
window.ST_TEXT = ST_TEXT;

function paintTask(t){
  if(!t.el) return;
  var st = t.status;
  t.el.className = 'tk' + (st==='ok'||st==='skip' ? ' done' : '') + (st==='fail' ? ' fail' : '');
  var pct = st === 'ok' || st === 'skip' ? 100
          : (t.total ? Math.min(99, Math.floor(t.loaded*100/t.total)) : 0);
  t.elBar.style.width = pct + '%';
  if(st === 'ok' || st === 'skip') t.elBar.style.background = 'var(--ok)';
  else if(st === 'fail') t.elBar.style.background = 'var(--err)';
  else t.elBar.style.background = 'var(--pri)';
  t.elPct.textContent = (t.total||t.loaded) ? (st==='ok'||st==='skip' ? '100%' : pct+'%') : '';
  t.elSz.textContent = t.total ? fmtSize(t.total) : (t.loaded ? fmtSize(t.loaded) : '');
  var stText = st === 'fail' ? '失败'
             : (st === 'wait' && t.probe && !t.probe.ok) ? '预检 ⚠'
             : (ST_TEXT[st] || '');
  if(!t._stText){
    t._stText = document.createTextNode(stText);
    t.elSt.appendChild(t._stText);
  }else{
    t._stText.nodeValue = stText;
  }
  if(!t._shaMark){
    t._shaMark = document.createElement('span');
    t._shaMark.className = 'sha-mark';
    t._shaMark.style.marginLeft = '4px';
    t.elSt.appendChild(t._shaMark);
  }
  if(st === 'ok' || st === 'skip'){
    if(t.hashSha256){
      t._shaMark.innerHTML = '<span title="SHA-256: '+esc(t.hashSha256)+'" style="color:var(--ok);font-weight:600">✓SHA</span>';
    }else if(t.hashErr){
      t._shaMark.innerHTML = '<span title="'+esc(t.hashErr)+'" style="color:var(--warn);font-weight:600">!SHA</span>';
    }else{
      t._shaMark.innerHTML = '<span class="sp" title="SHA-256 计算中…"></span>';
    }
  }else{
    t._shaMark.innerHTML = '';
  }
  t.elSt.className = 'st ' + st;
  if(st === 'fail' && t.err) t.elSt.title = t.err;
  else if(st === 'wait' && t.probe) t.elSt.title = t.probe.ok ? ('预检通过：' + t.probe.msg) : ('预检异常：' + t.probe.msg);
}
function paintGroup(g){
  var done = 0, fail = 0;
  g.tasks.forEach(function(t){ if(t.status==='ok'||t.status==='skip') done++; else if(t.status==='fail') fail++; });
  if(g.mini) g.mini.style.width = (done*100/Math.max(g.tasks.length,1)) + '%';
  if(g.ct) g.ct.textContent = done + '/' + g.tasks.length + (fail ? '（失败'+fail+'）' : '');
}

var lastPaint = 0;
function updateSummary(force){
  var ok=0, fail=0, sel=0;
  for(var i=0;i<TASKS.length;i++){
    var t = TASKS[i];
    if(t.status==='ok'||t.status==='skip') ok++;
    else if(t.status==='fail') fail++;
    if(t.sel) sel++;
  }
  $('sSel').textContent = sel;
  $('sTotal').textContent = TASKS.length;
  $('sDone').textContent = ok;
  $('sFail').textContent = fail;
  $('sSize').textContent = fmtSize(S.bytes);
  $('sSpeed').textContent = S.running && !S.paused ? fmtSpeed(S.speed) : '—';
  var sc = $('selCnt'); if(sc) sc.textContent = '已选 ' + sel;

  var now = Date.now();
  if(force || now - lastPaint > 220){
    lastPaint = now;
    var doneAll = 0;
    S.groups.forEach(function(g){ paintGroup(g); doneAll += g.tasks.filter(function(t){return t.status==='ok'||t.status==='skip';}).length; });
    $('gpBar').style.width = (doneAll*100/Math.max(TASKS.length,1)) + '%';
    var remain = S.speed > 0 ? (TASKS.length - doneAll) * (S.bytes/Math.max(doneAll,1)) / S.speed : NaN;
    $('sEta').textContent = (S.running && !S.paused && S.speed > 0) ? fmtEta(remain) : '—';
  }

  $('btnStart').disabled = S.running || sel===0;
  $('btnStart').textContent = S.running ? (S.paused ? '已暂停' : '下载中…') : (sel ? '开始下载（已选 '+sel+'）' : '开始下载');
  $('btnPause').disabled = !S.running;
  $('btnPause').textContent = S.paused ? '继续' : '暂停';
  $('btnStop').disabled = !S.running && !TASKS.some(function(t){return t.status==='run'||t.status==='pause';});
}

/* ---------- 下载引擎 ---------- */
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
async function waitResume(){
  while(S.paused && !S.stopAll) await sleep(120);
}
async function ensureOutDir(g){
  if(g.outHandle) return g.outHandle;
  var root = S.outHandle || S.rootHandle;
  g.outHandle = await root.getDirectoryHandle(g.outName, {create:true});
  return g.outHandle;
}

async function downloadTask(t){
  if(S.nativeMode) return downloadTaskNative(t);
  var g = t.group;
  var outDir = await ensureOutDir(g);
  var dupMode = $('optDup').value;
  var name = t.filename;

  var existHandle = null, existSize = 0;
  try{
    existHandle = await outDir.getFileHandle(name);
    existSize = (await existHandle.getFile()).size;
  }catch(e){ existHandle = null; existSize = 0; }

  if(!/\.[A-Za-z0-9]{1,8}$/.test(name)){
    try{
      var pr = await fetch(t.url, fetchOpts({'Range':'bytes=0-1023'}));
      var ext = extFromMime(pr.headers.get('content-type'));
      pr.body && pr.body.cancel && pr.body.cancel().catch(function(){});
      if(ext){
        name = name.replace(/\.download$/,'') + ext;
        t.filename = name;
        var h2 = null, s2 = 0;
        try{ h2 = await outDir.getFileHandle(name); s2 = (await h2.getFile()).size; }catch(e){}
        existHandle = h2; existSize = s2;
      }
    }catch(e){}
  }

  if(dupMode === 'skip' && existSize > 0){
    t.status = 'skip'; t.loaded = existSize; t.total = existSize;
    paintTask(t); return 'skip';
  }

  var pos = (dupMode === 'resume' && existSize > 0) ? existSize : 0;
  var rangeHeaders = {};
  if(pos > 0) rangeHeaders['Range'] = 'bytes=' + pos + '-';

  var res, retried = 0, maxRetry = 3;
  while(true){
    var ctl = new AbortController();
    var tid = setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, 60000);
    try{
      res = await fetch(t.url, fetchOpts(rangeHeaders, ctl.signal));
      clearTimeout(tid);
      break;
    }catch(e){
      clearTimeout(tid);
      if(S.stopAll) return 'stop';
      if(++retried > maxRetry) throw new Error('重试 3 次仍失败：' + (e.message || e));
      await sleep(800 * retried);
    }
  }
  if(res.status === 416 && pos > 0){ t.status='skip'; paintTask(t); return 'skip'; }
  if(!res.ok) throw new Error('HTTP ' + res.status);

  var cl = parseInt(res.headers.get('content-length') || '0', 10);
  var partial = (res.status === 206);

  if(pos > 0 && !partial){
    if(cl && cl === existSize){
      try{ res.body && res.body.cancel && res.body.cancel(); }catch(e){}
      t.status='skip'; t.loaded=existSize; t.total=existSize;
      paintTask(t); return 'skip';
    }
    pos = 0;
  }
  var total = partial ? cl + pos : cl;

  if(!/\.[A-Za-z0-9]{1,8}$/.test(name)){
    var ext2 = extFromMime(res.headers.get('content-type'));
    if(ext2){ name = name.replace(/\.download$/,'') + ext2; t.filename = name; }
  }

  t.total = total; t.loaded = pos; t.status = 'run';
  paintTask(t);

  var fh = await outDir.getFileHandle(name, {create:true});
  var w = await fh.createWritable({keepExistingData: pos > 0});
  try{
    if(pos > 0){ await w.truncate(pos); await w.seek(pos); }
    else { await w.truncate(0); }
  }catch(e){ try{ await w.seek(pos); }catch(e2){} }

  var reader = res.body.getReader();
  var lastUi = 0;
  try{
    while(true){
      if(S.stopAll){ throw {__stop:1}; }
      await waitResume();
      var rd = await Promise.race([
        reader.read(),
        new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('read timeout 30s')); }, 30000); })
      ]);
      if(rd.done) break;
      await w.write(rd.value);
      t.loaded += rd.value.length;
      S.bytes += rd.value.length;
      var now2 = Date.now();
      if(now2 - lastUi > 180){ lastUi = now2; paintTask(t); }
    }
    await w.close();
  }catch(e){
    try{ w && await w.abort(); }catch(e2){ try{ w && await w.close(); }catch(e3){} }
    if(e && e.__stop){ t.status = 'pause'; paintTask(t); return 'stop'; }
    throw e;
  }

  if(total && t.loaded !== total) throw new Error('大小不符 ' + t.loaded + '/' + total);
  t.status = 'ok'; paintTask(t);

  if($('optHashSha').checked){
    computeHashAsync(t, fh);
  }
  return 'ok';
}

/* ---------- 桌面原生下载通道（Rust/reqwest） ----------
 * 价值：Cookie/Referer/User-Agent 等浏览器禁止头都能发、不受 CORS 拦——
 * 内网系统、防盗链链接在桌面版也能下。输出目录用 Tauri 对话框选的真实路径
 * （浏览器句柄没有路径可给 Rust），断点续传/跳过按磁盘上的文件大小判断。
 * 与浏览器通道的差异：①暂停只在任务之间生效（进行中的任务不打断）；
 * ②扩展名 MIME 探测跳过（文件名保持扫描时的推断）；③SHA-256 由 Rust 端计算。 */
async function downloadTaskNative(t){
  var D = TB.desktop;
  if(!D || !D.httpDownload) throw new Error('原生下载通道不可用（桌面桥未加载）');
  var g = t.group;
  var dupMode = $('optDup').value;
  var dest = S.nativeOut + '\\' + g.outName + '\\' + t.filename;

  var existSize = 0;
  try{ existSize = await D.fileSize(dest); }catch(e){ existSize = 0; }
  if(dupMode === 'skip' && existSize > 0){
    t.status = 'skip'; t.loaded = existSize; t.total = existSize;
    paintTask(t); return 'skip';
  }

  t.status = 'run';
  t.loaded = (dupMode === 'resume') ? existSize : 0;
  paintTask(t);

  var info = customHeaderInfo();
  var headers = [];
  Object.keys(info.raw).forEach(function(k){ headers.push([k, info.raw[k]]); });

  var retried = 0, maxRetry = 3, lastUi = 0;
  while(true){
    try{
      var finalSize = await D.httpDownload({
        id: t.id, url: t.url, dest: dest, headers: headers,
        resume: dupMode === 'resume',
        onProgress: function(p){
          if(S.stopAll){ try{ D.httpCancel(t.id); }catch(e){} return; }
          var delta = p.loaded - t.loaded;
          if(delta > 0) S.bytes += delta;
          t.loaded = p.loaded;
          if(p.total) t.total = p.total;
          var now3 = Date.now();
          if(now3 - lastUi > 180){ lastUi = now3; paintTask(t); }
        }
      });
      if(finalSize != null){
        var delta2 = finalSize - t.loaded;
        if(delta2 > 0) S.bytes += delta2;
        t.loaded = finalSize;
        if(!t.total) t.total = finalSize;
      }
      t.status = 'ok'; paintTask(t);
      if($('optHashSha').checked) computeHashNative(t, dest);
      return 'ok';
    }catch(e){
      var msg = String((e && e.message) || e);
      if(S.stopAll || /cancel/i.test(msg)){ t.status = 'pause'; paintTask(t); return 'stop'; }
      if(++retried > maxRetry) throw new Error('重试 3 次仍失败：' + msg);
      await sleep(800 * retried);
    }
  }
}
async function computeHashNative(t, dest){
  try{
    t.hashSha256 = await TB.desktop.sha256File(dest);
    t.hashSize = t.loaded || 0;
    paintTask(t);
  }catch(e){
    t.hashErr = e.message || String(e);
    paintTask(t);
  }
}

async function computeHashAsync(t, fh){
  try{
    var file = await fh.getFile();
    t.hashSha256 = await U.sha256Of(file);
    t.hashSize = file.size;
    paintTask(t);
  }catch(e){
    t.hashErr = e.message || String(e);
    paintTask(t);
  }
}
async function writeChecksums(g){
  var lines = ['# SHA-256 校验和（由 办公工具箱·批量下载 生成）'];
  lines.push('# 生成时间：' + new Date().toLocaleString('zh-CN'));
  var n = 0;
  g.tasks.forEach(function(t){
    if(t.hashSha256){
      lines.push(t.hashSha256 + '  ' + t.filename);
      n++;
    }
  });
  if(!n){ return { ok:false, n:0 }; }
  if(S.nativeMode){
    await TB.desktop.saveText(S.nativeOut + '\\' + g.outName + '\\_checksums.sha256.txt', lines.join('\n') + '\n');
    return { ok:true, n:n, file:'_checksums.sha256.txt' };
  }
  var fh = await g.outHandle.getFileHandle('_checksums.sha256.txt', {create:true});
  var w = await fh.createWritable();
  await w.write(lines.join('\n') + '\n');
  await w.close();
  return { ok:true, n:n, file:'_checksums.sha256.txt' };
}

$('btnStart').onclick = function(){
  var list = TASKS.filter(function(t){ return t.sel; });
  if(!list.length){ notice('warn','请先勾选任务。'); return; }
  if(S.nativeMode && !S.nativeOut){ notice('warn','原生下载通道已开启，但还没选「原生输出」目录。'); return; }
  warnForbiddenHeaders();
  var pending = list.filter(function(t){ return t.status!=='ok' && t.status!=='skip'; });
  if(!pending.length){
    notice('info','所选任务都已完成，正在重新检查 '+list.length+' 个文件…');
  }
  startRun(list);
};

async function startRun(list){
  S.running = true; S.paused = false; S.stopAll = false;
  S.abort = new AbortController();
  S.startedAt = Date.now(); S.lastBytes = S.bytes; S.lastTs = Date.now();
  list.forEach(function(t){ if(t.status !== 'ok'){ t.status='wait'; t.loaded=0; t.err=''; paintTask(t); } });
  updateSummary(true);

  var conc = parseInt($('optConc').value, 10) || 4;
  var idx = 0;

  var tick = setInterval(function(){
    var now = Date.now(), dt = (now - S.lastTs)/1000;
    var instant = dt > 0 ? (S.bytes - S.lastBytes)/dt : 0;
    S.speed = S.speed ? S.speed * 0.7 + instant * 0.3 : instant;
    S.lastBytes = S.bytes; S.lastTs = now;
    updateSummary();
  }, 400);

  async function worker(){
    while(true){
      if(S.stopAll) return;
      var i = idx++;
      if(i >= list.length) return;
      var t = list[i];
      await waitResume();
      if(S.stopAll) return;
      try{
        await downloadTask(t);
      }catch(e){
        if((e && e.name === 'AbortError') || S.stopAll){
          t.status = 'pause';
        }else{
          t.status = 'fail';
          t.err = (e && e.message) ? e.message : String(e);
        }
        paintTask(t);
      }
      updateSummary(true);
    }
  }

  var ws = [];
  for(var i=0;i<Math.min(conc, list.length);i++) ws.push(worker());
  await Promise.all(ws);
  clearInterval(tick);

  S.running = false; S.paused = false;
  var fail = list.filter(function(t){ return t.status==='fail'; }).length;
  var ok = list.filter(function(t){ return t.status==='ok'||t.status==='skip'; }).length;
  updateSummary(true);
  $('gpBar').style.width = '100%';
  if(S.stopAll){
    notice('info','已停止。已下载 '+ok+' 个'+(fail?'，失败 '+fail+' 个':'')+'。再点「开始下载」会接着下。');
  }else{
    notice(fail ? 'warn' : 'info','本轮结束：成功 '+ok+' 个，失败 '+fail+' 个，共 '+fmtSize(S.bytes)+'。' +
      (fail ? '可点「重跑失败项」重试，或「导出失败清单」留档 / 换网络环境再下。' : ''));
  }
  S.stopAll = false;
}

$('btnPause').onclick = function(){
  S.paused = !S.paused;
  updateSummary(true);
  if(S.paused) notice('info','已暂停（正在传输的文件会先落盘）。点「继续」恢复。');
};
$('btnStop').onclick = function(){
  if(!S.running) return;
  S.stopAll = true; S.paused = false;
  try{ S.abort && S.abort.abort(); }catch(e){}
  updateSummary(true);
};

$('btnSelAll').onclick = function(){ setSel(function(){ return true; }); };
$('btnSelNone').onclick = function(){ setSel(function(){ return false; }); };
$('btnSelInvert').onclick = function(){ setSel(function(t){ return !t.sel; }); };
$('btnSelFail').onclick = function(){ setSel(function(t){ return t.status==='fail'||t.status==='pause'||t.status==='wait'; }); };
function setSel(fn){
  TASKS.forEach(function(t){ t.sel = fn(t); if(t.cb) t.cb.checked = t.sel; });
  updateSummary(true);
}

/* ---------- 下载前预检：并发探测所有勾选链接，废链下载前就标出来 ----------
 * 用 GET + Range: bytes=0-0（HEAD 在不少服务器/网盘上不可靠），拿到状态码即取消响应体。
 * 跨域且无 CORS 的站点 fetch 会直接抛错 —— 如实标「网络错误或跨域限制」，不假装能下。 */
$('btnProbe').onclick = async function(){
  if(S.running){ notice('warn','正在下载中，请结束后再预检。'); return; }
  var list = TASKS.filter(function(t){ return t.sel; });
  if(!list.length){ notice('warn','请先勾选要预检的任务。'); return; }
  warnForbiddenHeaders();
  var btn = this; btn.disabled = true;
  var done = 0, bad = 0, idx = 0;
  async function worker(){
    while(true){
      var i = idx++;
      if(i >= list.length) return;
      var t = list[i];
      t.probe = await probeOne(t);
      if(!t.probe.ok) bad++;
      done++;
      btn.textContent = '预检中 ' + done + '/' + list.length + ' …';
      paintTask(t);
    }
  }
  var ws = [];
  for(var k=0;k<Math.min(8, list.length);k++) ws.push(worker());
  await Promise.all(ws);
  btn.disabled = false; btn.textContent = '预检链接';
  notice(bad ? 'warn' : 'info',
    '预检完成：共 ' + list.length + ' 条，正常 ' + (list.length - bad) + ' 条，异常 ' + bad + ' 条' +
    (bad ? '。异常项已标「预检 ⚠」，悬停查看原因；可取消勾选后再开始下载。' : '。'));
};
async function probeOne(t){
  var ctl = new AbortController();
  var tid = setTimeout(function(){ try{ ctl.abort(); }catch(e){} }, 10000);
  try{
    var res = await fetch(t.url, fetchOpts({ 'Range':'bytes=0-0' }, ctl.signal));
    clearTimeout(tid);
    try{ res.body && res.body.cancel && res.body.cancel().catch(function(){}); }catch(e){}
    if(res.ok || res.status === 206 || res.status === 416){
      var len = parseInt(res.headers.get('content-length') || '0', 10);
      return { ok:true, status:res.status, msg:'HTTP ' + res.status + (len ? ' · 约 ' + fmtSize(len) : '') };
    }
    var why = res.status === 404 ? '（不存在）' : res.status === 403 ? '（被拒绝，可能是防盗链/需要登录）'
            : res.status === 401 ? '（需要认证，试试自定义请求头或携带登录 Cookie）'
            : res.status >= 500 ? '（服务器错误）' : '';
    return { ok:false, status:res.status, msg:'HTTP ' + res.status + why };
  }catch(e){
    clearTimeout(tid);
    if(e && e.name === 'AbortError') return { ok:false, status:0, msg:'超时（10 秒无响应）' };
    return { ok:false, status:0, msg:'网络错误或跨域限制：' + String(e.message || e).slice(0,80) };
  }
}

/* ---------- 失败重跑 / 失败清单 ---------- */
$('btnRetryFail').onclick = function(){
  if(S.running){ notice('warn','正在下载中，请结束后再重跑。'); return; }
  var fails = TASKS.filter(function(t){ return t.status==='fail' || t.status==='pause'; });
  if(!fails.length){ notice('info','没有失败或中断的项。'); return; }
  setSel(function(t){ return fails.indexOf(t) >= 0; });
  warnForbiddenHeaders();
  startRun(fails);
};
$('btnExpFail').onclick = function(){
  var fails = TASKS.filter(function(t){ return t.status==='fail' || t.status==='pause'; });
  if(!fails.length){ notice('info','没有失败或中断的项可导出。'); return; }
  var txt = DC.failListTxt ? DC.failListTxt(fails)
          : fails.map(function(t){ return (t.title ? t.title + '\t' : '') + t.url; }).join('\r\n');
  var blob = new Blob(['\ufeff' + txt], {type:'text/plain;charset=utf-8'});
  U.saveBlob(blob, '失败清单.txt');
  notice('info','已导出 失败清单.txt（' + fails.length + ' 条）——放回源文件夹重新扫描即可再下。');
};

/* ---------- 原生下载通道 UI（仅桌面壳里显示） ---------- */
if(window.__TAURI__){
  $('optNativeLabel').style.display = '';
  $('nativeOutRow').style.display = '';
}
$('optNative').onchange = function(){
  S.nativeMode = this.checked;
  if(!this.checked) return;
  if(!S.nativeOut){
    notice('info','已启用原生下载通道：请在上方「原生输出」选一个输出目录（系统对话框，Rust 需要真实路径）。');
  }
  var info = customHeaderInfo();
  if(info.forbidden.length){
    notice('info','原生通道下这些头会真正生效：' + esc(info.forbidden.map(function(f){ return f.name; }).join('、')));
  }
};
$('btnNativeOut').onclick = async function(){
  var D = TB.desktop;
  if(!D || !D.pickFolder){ notice('err','原生下载通道仅桌面版可用。'); return; }
  try{
    var d = await D.pickFolder();
    if(!d) return;
    S.nativeOut = d.path;
    $('nativeOutPath').value = d.path + '\\';
    notice('info','原生输出目录：' + esc(d.path));
  }catch(e){ notice('err','选择失败：' + esc(e.message||e)); }
};

/* ---------- 导出 ---------- */
$('btnExpSha').onclick = async function(){
  if(!S.groups.length){ notice('warn','没有可导出的分组。'); return; }
  var total = 0, files = [];
  for(var i=0;i<S.groups.length;i++){
    var g = S.groups[i];
    if(!g.outHandle){ continue; }
    var have = g.tasks.filter(function(t){ return t.hashSha256; }).length;
    if(!have){ continue; }
    try{
      var r = await writeChecksums(g);
      if(r.ok){
        total += r.n;
        files.push(g.outName + '\\' + r.file + '  (' + r.n + ' 条)');
      }
    }catch(e){
      notice('warn','写入 ' + g.outName + ' 失败：' + (e.message || e));
    }
  }
  if(total === 0){
    notice('warn','没有已算好的 SHA-256。请先在下载时勾选「算 SHA-256」并下载完成。');
    return;
  }
  notice('info','已写入 ' + total + ' 条 SHA-256 到：<br>' + files.map(esc).join('<br>'));
};
$('btnExpTxt').onclick = function(){
  var lines = [];
  var outRoot = (S.outHandle && S.outHandle.name) || (S.rootHandle && S.rootHandle.name) || '';
  lines.push('# 下载目录：' + (outRoot || '(未设置)') + '\\');
  lines.push('# 每个 txt 一组子目录：' + outRoot + '\\<txt名>\\');
  lines.push('');
  S.groups.forEach(function(g){
    lines.push('## ' + g.name + '  →  ' + (outRoot ? outRoot + '\\' : '') + g.outName + '\\');
    g.tasks.forEach(function(t){
      lines.push((t.title ? t.title + '\t' : '') + t.url);
    });
    lines.push('');
  });
  var blob = new Blob(['\ufeff' + lines.join('\r\n')], {type:'text/plain;charset=utf-8'});
  U.saveBlob(blob, '下载链接清单.txt');
  notice('info','已导出 下载链接清单.txt（共 '+TASKS.length+' 条）');
};
$('btnExpXlsx').onclick = async function(){
  if(!TASKS.length){ notice('warn','没有可导出的链接。'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '生成中…';
  try{
    var outRoot = (S.outHandle && S.outHandle.name) || (S.rootHandle && S.rootHandle.name) || '';
    var headers = ['所属txt','下载根目录','输出目录','序号','标题','文件名','大小(字节)','状态','链接','失败原因','预检'];
    var rows = [];
    S.groups.forEach(function(g){
      g.tasks.forEach(function(t, i){
        rows.push([g.path, outRoot + '\\', g.outName+'\\', i+1, t.title || '', t.filename,
                   t.total || 0, ST_TEXT[t.status] || '等待', t.url,
                   t.err || '', t.probe ? ((t.probe.ok ? '通过 ' : '异常 ') + t.probe.msg) : '']);
      });
    });
    var blob = await U.makeXlsx(headers, rows, '链接清单');
    U.saveBlob(blob, '下载链接清单.xlsx');
    notice('info','已导出 下载链接清单.xlsx（共 '+rows.length+' 行）');
  }catch(e){
    notice('err','导出 Excel 失败：' + esc(e.message));
  }finally{
    btn.disabled = false; btn.textContent = '导出 Excel';
  }
};

updateSummary(true);
})();
