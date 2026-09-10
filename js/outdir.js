/* ============ 统一输出目录（偏好 + 可选 File System Access） ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

var DB_NAME = 'tb-outdir';
var STORE = 'handles';
var KEY = 'current';

function openDb(){
  return new Promise(function(res, rej){
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = function(){ res(req.result); };
    req.onerror = function(){ rej(req.error); };
  });
}
async function idbPut(val){
  var db = await openDb();
  return new Promise(function(res, rej){
    var tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, KEY);
    tx.oncomplete = function(){ res(true); };
    tx.onerror = function(){ rej(tx.error); };
  });
}
async function idbGet(){
  var db = await openDb();
  return new Promise(function(res, rej){
    var tx = db.transaction(STORE, 'readonly');
    var r = tx.objectStore(STORE).get(KEY);
    r.onsuccess = function(){ res(r.result || null); };
    r.onerror = function(){ rej(r.error); };
  });
}
async function idbDel(){
  var db = await openDb();
  return new Promise(function(res, rej){
    var tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = function(){ res(true); };
    tx.onerror = function(){ rej(tx.error); };
  });
}

var state = {
  handle: null,
  name: '',
  defaultDownload: true
};

function render(){
  var el = $('outDirPath');
  if (!el) return;
  if (state.handle){
    el.value = state.name + '\\';
    el.placeholder = '';
  } else {
    el.value = '';
    el.placeholder = U.FS_OK ? '未设置 — 各工具仍可用浏览器默认下载' : '当前浏览器不支持选文件夹';
  }
  var badge = $('outDirBadge');
  if (badge){
    badge.textContent = state.handle ? ('统一目录：' + state.name) : '统一目录：未设置';
    badge.className = 'badge' + (state.handle ? '' : '');
  }
}

async function restore(){
  if (!U.FS_OK){ render(); return; }
  try{
    var saved = await idbGet();
    if (saved && saved.handle){
      var perm = await saved.handle.queryPermission({ mode:'readwrite' });
      if (perm === 'granted'){
        state.handle = saved.handle;
        state.name = saved.handle.name;
      } else {
        // 仍显示名称，授权在操作时再要
        state.handle = saved.handle;
        state.name = saved.handle.name || '(已记住目录)';
      }
    }
  }catch(e){}
  render();
}

async function ensurePermission(){
  if (!state.handle) return false;
  var perm = await state.handle.queryPermission({ mode:'readwrite' });
  if (perm === 'granted') return true;
  perm = await state.handle.requestPermission({ mode:'readwrite' });
  return perm === 'granted';
}

$('outDirBrowse').onclick = async function(){
  if (!U.FS_OK){ notice('err','当前浏览器不支持，请用 Chrome / Edge'); return; }
  try{
    var h = await window.showDirectoryPicker({ id:'tb-outdir', mode:'readwrite' });
    state.handle = h;
    state.name = h.name;
    await idbPut({ handle: h, name: h.name, at: Date.now() });
    render();
    notice('info','统一输出目录已设为：<b>' + h.name + '</b>。导出/下载将优先写入该目录。');
  }catch(e){
    if (e.name !== 'AbortError') notice('err','选择失败：' + e.message);
  }
};

$('outDirClear').onclick = async function(){
  state.handle = null;
  state.name = '';
  try{ await idbDel(); }catch(e){}
  render();
  notice('info','已清除统一目录，恢复浏览器默认下载。');
};

/**
 * 统一保存：若设置了目录，则写入该目录；否则走浏览器下载。
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<{mode:'dir'|'download', name:string}>}
 */
async function saveViaOutDir(blob, filename){
  var safe = String(filename || 'file.bin').replace(/[\\\/:*?"<>|]/g,'_');
  if (state.handle){
    var ok = await ensurePermission();
    if (ok){
      try{
        var fh = await state.handle.getFileHandle(safe, { create:true });
        var w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return { mode:'dir', name: state.name + '\\' + safe };
      }catch(e){
        notice('warn','写入统一目录失败，改为浏览器下载：' + (e.message || e));
      }
    }
  }
  U.saveBlob(blob, safe);
  return { mode:'download', name: safe };
}

TB.outDir = {
  get: function(){ return state; },
  save: saveViaOutDir,
  ensure: ensurePermission
};

// 顶栏徽章 + 设置按钮
(function(){
  var top = document.querySelector('.top');
  if (top){
    var b = document.createElement('button');
    b.className = 'sm';
    b.id = 'outDirBadge';
    b.style.marginLeft = '10px';
    b.title = '设置统一输出目录（Chrome/Edge）';
    b.textContent = '统一目录：未设置';
    b.onclick = function(){
      var a = document.querySelector('[data-tool="outdir"]');
      if (a) a.click();
    };
    // 插入到 compat badge 之前
    var compat = $('compat');
    if (compat) top.insertBefore(b, compat);
    else top.appendChild(b);
  }
})();

restore();

// 侧栏点击时若不存在 outdir 工具页则忽略
})();
