/* ============ 桌面专属：环境检测 / 转码 / Office / OCR / 清理 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

function tauri(){ return window.__TAURI__ || null; }
function isDesktop(){ return !!(tauri() && tauri().core && tauri().core.invoke); }

function invoke(cmd, args){
  var t = tauri();
  if (!t || !t.core || !t.core.invoke){
    return Promise.reject(new Error('不在桌面壳中（请用安装后的 exe 或 npm run dev）'));
  }
  return t.core.invoke(cmd, args);
}

function setDesktopBadge(){
  var el = $('deskBadge');
  if (!el) return;
  el.textContent = isDesktop() ? '桌面模式' : '网页模式 · 转码/OCR 仅桌面可用';
  el.className = isDesktop() ? 'badge' : 'badge bad';
}
setDesktopBadge();

async function pickFile(exts){
  var t = tauri();
  if (!t || !t.dialog || !t.dialog.open) return null;
  var p = await t.dialog.open({
    multiple: false,
    filters: [{ name: '文件', extensions: exts || ['*'] }]
  });
  if (!p) return null;
  var path = typeof p === 'string' ? p : String(p);
  return { path: path, name: path.split(/[\\/]/).pop() };
}

/* ---------- 环境检测 ---------- */
var envCache = null;
async function refreshEnv(){
  var box = $('envStatus');
  if (!isDesktop()){
    box.innerHTML = '<div class="muted">当前为网页版。请安装桌面版，或在项目里执行 <span class="mono">npm run dev</span> 后使用转码 / Office / OCR / 清理 / 右键菜单。</div>';
    $('avRun').disabled = true;
    $('offRun').disabled = true;
    $('ocrRun').disabled = true;
    $('cleanRun').disabled = true;
    return;
  }
  box.textContent = '检测中…';
  try{
    envCache = await invoke('env_status');
    var rows = [
      ['版本', envCache.app_version],
      ['FFmpeg', envCache.ffmpeg ? (envCache.ffmpeg.indexOf('resources')>=0 || envCache.ffmpeg.indexOf('bin')>=0 ? envCache.ffmpeg + '（软件自带）' : envCache.ffmpeg) : '未找到 — 安装包应已内置；也可装 FFmpeg 并加入 PATH'],
      ['ffprobe', envCache.ffprobe || '—'],
      ['LibreOffice', envCache.soffice ? envCache.soffice : '未找到 — 未打进安装包（体积过大）。请到 libreoffice.org 自行安装后即可用 Office→PDF'],
      ['Tesseract', envCache.tesseract ? (envCache.tesseract.indexOf('resources')>=0 || envCache.tesseract.indexOf('tesseract')>=0 ? envCache.tesseract + '（软件自带）' : envCache.tesseract) : '未找到']
    ];
    box.innerHTML = rows.map(function(r){
      var warn = /未找到|未安装/.test(r[1]);
      return '<div style="display:flex;justify-content:space-between;gap:14px;padding:8px 0;border-bottom:1px solid var(--line2)">' +
        '<span class="muted">' + r[0] + '</span>' +
        '<span class="mono" style="text-align:right;word-break:break-all;color:' + (warn?'var(--warn)':'inherit') + '">' + esc(r[1]) + '</span></div>';
    }).join('');
    $('avRun').disabled = !envCache.ffmpeg;
    $('offRun').disabled = !envCache.soffice;
    $('ocrRun').disabled = false;
    $('cleanRun').disabled = false;
    notice('info','环境检测完成');
  }catch(e){
    box.textContent = '检测失败：' + (e.message || e);
    notice('err','检测失败：' + esc(e.message || e));
  }
}
$('btnEnvRefresh').onclick = refreshEnv;

/* ---------- 音视频转码 ---------- */
var avIn = null;
$('avPick').onclick = async function(){
  var f = await pickFile(['mp4','avi','mkv','mov','webm','flv','wmv','ts','m4v','mp3','wav','flac','aac','ogg','m4a']);
  if (!f){ notice('warn','未选择文件'); return; }
  avIn = f;
  $('avInfo').textContent = f.name + '\n' + f.path;
  $('avInfo').style.whiteSpace = 'pre-wrap';
};
$('avDrop').onclick = function(e){ if(e.target.tagName !== 'BUTTON') $('avPick').click(); };

$('avRun').onclick = async function(){
  if (!isDesktop() || !envCache || !envCache.ffmpeg){
    notice('err','需要桌面版且已安装 FFmpeg'); return;
  }
  if (!avIn){ notice('err','请先选择文件'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '转码中…';
  $('avMsg').textContent = 'FFmpeg 运行中，大文件请耐心等待…';
  try{
    var ext = $('avFmt').value;
    var output = avIn.path.replace(/\.[^.]+$/, '') + '_converted' + ext;
    if (ext === '.mp3' || ext === '.wav' || ext === '.m4a'){
      await invoke('ffmpeg_extract_audio', { ffmpeg: envCache.ffmpeg, input: avIn.path, output: output });
    } else {
      var extra = [];
      if (ext === '.gif') extra = ['-vf','fps=12,scale=480:-1:flags=lanczos','-loop','0'];
      if (ext === '.webm') extra = ['-c:v','libvpx','-b:v','1M','-c:a','libvorbis'];
      await invoke('ffmpeg_convert', { ffmpeg: envCache.ffmpeg, input: avIn.path, output: output, extraArgs: extra });
    }
    $('avMsg').textContent = '完成 → ' + output;
    notice('info','转码完成');
    try{ await invoke('reveal_in_explorer', { path: output }); }catch(e){}
  }catch(e){
    $('avMsg').textContent = String(e.message || e);
    notice('err','转码失败：' + esc(String(e.message || e).slice(0,220)));
  }finally{
    btn.disabled = false; btn.textContent = '开始转码';
  }
};

/* ---------- Office → PDF ---------- */
var offIn = null;
$('offPick').onclick = async function(){
  var f = await pickFile(['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp','rtf']);
  if (!f) return;
  offIn = f;
  $('offInfo').textContent = f.name + '\n' + f.path;
  $('offInfo').style.whiteSpace = 'pre-wrap';
};
$('offDrop').onclick = function(e){ if(e.target.tagName !== 'BUTTON') $('offPick').click(); };
$('offRun').onclick = async function(){
  if (!isDesktop() || !envCache || !envCache.soffice){
    notice('err','需要桌面版且已安装 LibreOffice'); return;
  }
  if (!offIn){ notice('err','请先选择 Office 文件'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '转换中…';
  try{
    var outDir = offIn.path.replace(/[\\/][^\\/]+$/, '');
    var pdf = await invoke('office_to_pdf', {
      soffice: envCache.soffice, input: offIn.path, outDir: outDir
    });
    $('offMsg').textContent = '完成 → ' + pdf;
    notice('info','已生成 PDF');
    try{ await invoke('reveal_in_explorer', { path: pdf }); }catch(e){}
  }catch(e){
    $('offMsg').textContent = String(e.message || e);
    notice('err','转换失败：' + esc(String(e.message || e).slice(0,220)));
  }finally{
    btn.disabled = false; btn.textContent = '转为 PDF';
  }
};

/* ---------- OCR ---------- */
var ocrIn = null;
$('ocrPick').onclick = async function(){
  var f = await pickFile(['png','jpg','jpeg','bmp','webp','tif','tiff','gif']);
  if (!f) return;
  ocrIn = f;
  $('ocrInfo').textContent = f.name + '\n' + f.path;
  $('ocrInfo').style.whiteSpace = 'pre-wrap';
};
$('ocrDrop').onclick = function(e){ if(e.target.tagName !== 'BUTTON') $('ocrPick').click(); };
$('ocrRun').onclick = async function(){
  if (!isDesktop()){ notice('err','OCR 需桌面版'); return; }
  if (!ocrIn){ notice('err','请先选择图片'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '识别中…';
  try{
    var text = await invoke('ocr_image', {
      path: ocrIn.path,
      tesseract: (envCache && envCache.tesseract) || null
    });
    $('ocrOut').value = text || '(未识别到文字)';
    notice('info','OCR 完成');
  }catch(e){
    notice('err','OCR 失败：' + esc(String(e.message || e).slice(0,220)));
    $('ocrOut').value = String(e.message || e);
  }finally{
    btn.disabled = false; btn.textContent = '开始识别';
  }
};
$('ocrCopy').onclick = function(){ U.copyText($('ocrOut').value); };
$('ocrToInvoice').onclick = function(){
  if (!$('ocrOut').value.trim()){ notice('warn','暂无文字'); return; }
  var ta = $('invText');
  if (ta){
    ta.value = (ta.value ? ta.value + '\n\n====\n\n' : '') + $('ocrOut').value;
    var nav = document.querySelector('[data-tool="invoice"]');
    if (nav) nav.click();
    notice('info','已送入发票提取');
  }
};

/* ---------- 大文件清理 ---------- */
$('cleanRun').onclick = async function(){
  if (!isDesktop()){ notice('err','清理需桌面版'); return; }
  var root = $('cleanRoot').value.trim();
  if (!root){ notice('warn','填写盘符或目录，例如 C:\\ 或 D:\\Downloads'); return; }
  var minMb = parseInt($('cleanMin').value, 10) || 100;
  var btn = this; btn.disabled = true; btn.textContent = '扫描中…';
  $('cleanList').innerHTML = '<div class="muted">扫描中（可能要数十秒）…</div>';
  try{
    var files = await invoke('scan_large_files', { root: root, minMb: minMb, maxResults: 200 });
    window.__cleanFiles = files;
    if (!files.length){
      $('cleanList').innerHTML = '<div class="muted">未找到 ≥ ' + minMb + 'MB 的文件（已跳过系统目录）</div>';
      return;
    }
    var h = '<div class="rtable"><table><thead><tr><th>大小</th><th>文件</th><th>操作</th></tr></thead><tbody>';
    files.forEach(function(f, i){
      h += '<tr><td style="white-space:nowrap">' + U.fmtSize(f.size) + '</td>' +
        '<td class="mono" style="word-break:break-all">' + esc(f.path) + '</td>' +
        '<td style="white-space:nowrap">' +
        '<button class="sm dan" data-recycle="' + i + '">回收站</button> ' +
        '<button class="sm" data-reveal="' + i + '">定位</button></td></tr>';
    });
    h += '</tbody></table></div>';
    $('cleanList').innerHTML = h;
    $('cleanList').querySelectorAll('[data-recycle]').forEach(function(b){
      b.onclick = async function(){
        var i = +b.getAttribute('data-recycle');
        var f = window.__cleanFiles[i];
        if (!f) return;
        if (!confirm('移到回收站？\n' + f.path + '\n\n大小 ' + U.fmtSize(f.size))) return;
        b.disabled = true;
        try{
          await invoke('recycle_file', { path: f.path });
          notice('info','已移入回收站：' + esc(f.name));
          b.closest('tr').style.opacity = '0.45';
        }catch(e){
          notice('err','删除失败：' + esc(String(e.message||e)));
          b.disabled = false;
        }
      };
    });
    $('cleanList').querySelectorAll('[data-reveal]').forEach(function(b){
      b.onclick = function(){
        var i = +b.getAttribute('data-reveal');
        var f = window.__cleanFiles[i];
        if (f) invoke('reveal_in_explorer', { path: f.path }).catch(function(){});
      };
    });
    notice('info','找到 ' + files.length + ' 个大文件');
  }catch(e){
    $('cleanList').innerHTML = '<div class="muted">' + esc(String(e.message||e)) + '</div>';
    notice('err','扫描失败：' + esc(String(e.message||e)));
  }finally{
    btn.disabled = false; btn.textContent = '开始扫描';
  }
};

/* ---------- 右键菜单 ---------- */
$('ctxRegister').onclick = async function(){
  if (!isDesktop()){ notice('err','请在桌面版中注册'); return; }
  try{
    var msg = await invoke('register_context_menu', { exePath: null });
    notice('info', esc(msg));
    $('ctxMsg').textContent = msg;
  }catch(e){
    notice('err', esc(String(e.message||e)));
    $('ctxMsg').textContent = String(e.message||e);
  }
};
$('ctxUnregister').onclick = async function(){
  if (!isDesktop()) return;
  try{
    var msg = await invoke('unregister_context_menu');
    notice('info', esc(msg));
    $('ctxMsg').textContent = msg;
  }catch(e){
    notice('err', esc(String(e.message||e)));
  }
};

refreshEnv();

/* 打开文件 / 导航事件 */
if (isDesktop() && tauri().event && tauri().event.listen){
  tauri().event.listen('open-file', function(ev){
    var p = ev && ev.payload;
    if (!p) return;
    notice('info','右键打开：<b>' + esc(p) + '</b>');
    if (/\.txt$/i.test(p)){
      document.querySelector('[data-tool="dl"]').click();
      $('ctxMsg').textContent = '已唤起应用。批量下载请在「批量下载」里选择该 txt 所在文件夹再扫描。文件：' + p;
    } else if (/\.pdf$/i.test(p)){
      document.querySelector('[data-tool="pdfcrypt"]').click();
      $('ctxMsg').textContent = '已唤起应用处理 PDF：' + p;
    }
  });
  tauri().event.listen('navigate-tool', function(ev){
    var id = ev && ev.payload;
    var nav = document.querySelector('[data-tool="'+id+'"]');
    if (nav) nav.click();
  });
}

TB.desktop = { invoke: invoke, isDesktop: isDesktop, refreshEnv: refreshEnv };
})();
