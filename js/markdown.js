/* ============ Markdown 编辑器 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

if (typeof window.markdownit === 'undefined'){
  notice('err','markdown-it 未加载。请确认 js/vendor/markdown-it.min.js 存在。');
  return;
}

var md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true
});

var STORAGE_KEY = 'tb-md-draft';

function render(){
  var src = $('mdSrc').value;
  var html;
  try{
    html = md.render(src);
  }catch(e){
    html = '<p style="color:#dc2626">渲染错误：' + e.message + '</p>';
  }
  $('mdPreview').innerHTML = html;
  updateStats(src);
  try{ localStorage.setItem(STORAGE_KEY, src); }catch(e){}
}

function updateStats(src){
  var chars = src.length;
  var lines = src ? src.split('\n').length : 0;
  var words = (src.match(/[一-龥]|[a-zA-Z0-9_]+/g) || []).length;
  $('mdStat').textContent = lines + ' 行 · ' + words + ' 词 · ' + chars + ' 字';
}

$('mdSrc').addEventListener('input', function(){
  clearTimeout(window.__mdT);
  window.__mdT = setTimeout(render, 120);
});

$('mdClear').onclick = function(){
  if (!confirm('清空当前草稿？')) return;
  $('mdSrc').value = '';
  render();
};
$('mdCopyHtml').onclick = function(){
  var html = $('mdPreview').innerHTML;
  U.copyText(html, '已复制 HTML 源码');
};
$('mdCopyMd').onclick = function(){
  U.copyText($('mdSrc').value);
};
$('mdDownloadMd').onclick = function(){
  var v = $('mdSrc').value;
  if (!v){ notice('warn','没有内容'); return; }
  U.saveBlob(new Blob([v], {type:'text/markdown;charset=utf-8'}), '文档.md');
};
$('mdDownloadHtml').onclick = function(){
  var title = prompt('HTML 标题？', '文档') || '文档';
  var body = $('mdPreview').innerHTML;
  var full = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + title.replace(/[<>&]/g,'') + '</title>\n' +
    '<style>body{font:16px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
    'max-width:780px;margin:40px auto;padding:0 20px;color:#1f2937}' +
    'pre{background:#f8fafc;padding:12px;border-radius:8px;overflow:auto}' +
    'code{font-family:ui-monospace,Consolas,monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px}' +
    'pre code{padding:0;background:none}' +
    'table{border-collapse:collapse}td,th{border:1px solid #e2e8f0;padding:6px 10px}' +
    'img{max-width:100%}blockquote{border-left:3px solid #cbd5e1;margin:0;padding:4px 14px;color:#64748b}' +
    '</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
  U.saveBlob(new Blob([full], {type:'text/html;charset=utf-8'}), title + '.html');
};

// 工具栏
document.querySelectorAll('[data-md]').forEach(function(b){
  b.onclick = function(){
    var kind = b.getAttribute('data-md');
    var ta = $('mdSrc');
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = ta.value.slice(s, e);
    var wrap = null, insert = null;
    if (kind === 'bold'){ wrap = '**'; }
    else if (kind === 'italic'){ wrap = '*'; }
    else if (kind === 'code'){ wrap = '`'; }
    else if (kind === 'h2'){ insert = '## ' + (sel || '标题') + '\n'; }
    else if (kind === 'h3'){ insert = '### ' + (sel || '标题') + '\n'; }
    else if (kind === 'ul'){ insert = (sel||'').split('\n').map(function(l,i){ return (i===0?'- ':'  - ') + l.replace(/^[-*]\s*/,''); }).join('\n') + '\n'; }
    else if (kind === 'ol'){ insert = (sel||'').split('\n').map(function(l,i){ return (i+1)+'. ' + l; }).join('\n') + '\n'; }
    else if (kind === 'link'){ insert = '[' + (sel||'链接文字') + '](https://)'; }
    else if (kind === 'img'){ insert = '![' + (sel||'描述') + '](https://)'; }
    else if (kind === 'hr'){ insert = '\n---\n'; }
    else if (kind === 'quote'){ insert = (sel||'引用').split('\n').map(function(l){ return '> ' + l; }).join('\n') + '\n'; }
    else if (kind === 'table'){
      insert = '| 列1 | 列2 |\n| --- | --- |\n| a | b |\n';
    }
    if (wrap != null){
      if (s === e){
        ta.setRangeText(wrap + '文本' + wrap, s, e, 'end');
        ta.selectionStart = s + wrap.length;
        ta.selectionEnd = s + wrap.length + 2;
      } else {
        ta.setRangeText(wrap + sel + wrap, s, e, 'select');
      }
    } else if (insert != null){
      ta.setRangeText(insert, s, e, 'end');
    }
    ta.focus();
    render();
  };
});

// 拖放 md 文件
$('mdDrop').onclick = function(){ $('mdFile').click(); };
$('mdDrop').addEventListener('dragover', function(e){ e.preventDefault(); this.classList.add('over'); });
$('mdDrop').addEventListener('dragleave', function(){ this.classList.remove('over'); });
$('mdDrop').addEventListener('drop', async function(e){
  e.preventDefault(); this.classList.remove('over');
  var f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) $('mdSrc').value = await f.text();
  render();
});
$('mdFile').onchange = async function(){
  var f = this.files && this.files[0];
  if (f) $('mdSrc').value = await f.text();
  this.value = '';
  render();
};

// 恢复草稿
try{
  var draft = localStorage.getItem(STORAGE_KEY);
  if (draft) $('mdSrc').value = draft;
}catch(e){}

render();
})();
