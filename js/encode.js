/* ============ 编码转换 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

/* Base64 */
function b64Encode(str, urlSafe, utf8){
  var bytes;
  if(utf8 !== false && $('b64Utf8').checked){
    bytes = new TextEncoder().encode(str);
  }else{
    bytes = new Uint8Array(str.length);
    for(var i=0;i<str.length;i++) bytes[i] = str.charCodeAt(i) & 0xff;
  }
  var bin = '';
  for(var i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  var b = btoa(bin);
  if(urlSafe) b = b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return b;
}
function b64Decode(b, urlSafe, utf8){
  if(urlSafe) b = b.replace(/-/g,'+').replace(/_/g,'/');
  while(b.length % 4) b += '=';
  var bin = atob(b);
  var bytes = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  if(utf8 !== false && $('b64Utf8').checked){
    return new TextDecoder('utf-8').decode(bytes);
  }
  var s = '';
  for(var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
  return s;
}
$('b64Enc').onclick = function(){
  try{
    $('b64Out').value = b64Encode($('b64In').value, $('b64Url').checked);
  }catch(e){ notice('err','编码失败：'+esc(e.message)); }
};
$('b64Dec').onclick = function(){
  try{
    $('b64Out').value = b64Decode($('b64In').value.trim(), $('b64Url').checked);
  }catch(e){ notice('err','解码失败：不是合法 Base64，或编码不对'); }
};
$('b64Copy').onclick = function(){ U.copyText($('b64Out').value); };
$('b64Clear').onclick = function(){ $('b64In').value=''; $('b64Out').value=''; };

/* URL / HTML */
$('urlEnc').onclick = function(){ $('urlOut').value = encodeURIComponent($('urlIn').value); };
$('urlDec').onclick = function(){
  try{ $('urlOut').value = decodeURIComponent($('urlIn').value); }
  catch(e){ notice('err','URL 解码失败'); }
};
function htmlEsc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
$('htmlEnc').onclick = function(){ $('urlOut').value = htmlEsc($('urlIn').value); };
$('htmlDec').onclick = function(){
  var d = document.createElement('textarea');
  d.innerHTML = $('urlIn').value;
  $('urlOut').value = d.value;
};

/* 文本编码转换 */
function decodeBytes(bytes, enc){
  try{ return new TextDecoder(enc).decode(bytes); }
  catch(e){ throw new Error('浏览器不支持解码 ' + enc); }
}
function encodeText(text, enc){
  if(enc === 'utf-8') return new TextEncoder().encode(text);
  if(enc === 'utf-16le'){
    var u8 = new Uint8Array(text.length * 2);
    for(var i=0;i<text.length;i++){
      var c = text.charCodeAt(i);
      u8[i*2] = c & 0xff; u8[i*2+1] = (c >> 8) & 0xff;
    }
    return u8;
  }
  if(enc === 'utf-16be'){
    var u8 = new Uint8Array(text.length * 2);
    for(var i=0;i<text.length;i++){
      var c = text.charCodeAt(i);
      u8[i*2] = (c >> 8) & 0xff; u8[i*2+1] = c & 0xff;
    }
    return u8;
  }
  if(enc === 'gbk'){
    // TextEncoder 不支持 GBK。用「解码回显」技巧不可行，提示用户。
    // Chrome 的 TextDecoder 支持 gbk 解码，但编码需要手动。
    // 这里用一个已知可行的 trick：创建 blob 并通过特殊路径 —— 实际上浏览器不提供 GBK 编码。
    throw new Error('浏览器不支持把文本编码为 GBK。可把「源编码」设为 GBK、目标设为 UTF-8 做转码；\n若必须输出 GBK，请用系统记事本另存为 ANSI。');
  }
  throw new Error('不支持的编码：' + enc);
}
var lastDecodedBytes = null;
var lastDecodedText = '';

$('encRun').onclick = function(){
  var from = $('encFrom').value, to = $('encTo').value;
  try{
    // 若输入看起来是文本：先按 from 从文本字符重新编码不适用。
    // 策略：文本框输入的是「已经是 from 编码被错误解成 UTF-8」的场景较少。
    // 实用场景：用户粘贴 GBK 解码乱码 或 直接粘贴正常文本（源=UTF-8）。
    // 我们把 textarea 内容用当前浏览器按 UTF-8 编码后，若 from 是 gbk，需要原始字节。
    // 因此：优先用文件上传；文本框则假定用户粘贴的就是正确显示的文本，
    // 转码 = 按 from 的字节解释。对 UTF-8→其他：直接 encode。
    // 对「GBK 文本框」：说明用户看到的是 mojibake，我们无法还原。
    // 提供：若 lastDecodedBytes 来自文件，用文件字节；否则用 UTF-8 字节当源。
    var srcBytes;
    if(lastDecodedBytes && $('encIn').value === lastDecodedText){
      srcBytes = lastDecodedBytes;
    }else{
      // 将文本按「伪 Latin-1」取出字节不可靠；统一用 UTF-8 字节作为源，
      // 再尝试用 from 解码 —— 若 from 是 utf-8 且文本正常，结果正确。
      srcBytes = new TextEncoder().encode($('encIn').value);
      if(from !== 'utf-8'){
        // 把 UTF-8 字节当 from 解码会得到乱码，提示用户优先用文件
        $('encMsg').textContent = '提示：文本框按 UTF-8 字节处理。GBK/UTF-16 请点「从文件读取」。';
      }
    }
    var text = decodeBytes(srcBytes, from);
    var outBytes = encodeText(text, to);
    if(to === 'utf-8' || to === 'utf-16le' || to === 'utf-16be'){
      if(to === 'utf-8'){
        $('encOut').value = text;
      }else{
        $('encOut').value = Array.from(outBytes).map(function(b){
          return ('0'+b.toString(16)).slice(-2);
        }).join(' ');
      }
      lastDecodedBytes = outBytes;
      lastDecodedText = to === 'utf-8' ? text : $('encOut').value;
      $('encMsg').textContent = '完成：' + from + ' → ' + to + '（' + outBytes.length + ' 字节）';
    }
  }catch(e){
    notice('err', esc(e.message));
    $('encMsg').textContent = e.message;
  }
};

$('encFileBtn').onclick = function(){ $('encFile').click(); };
$('encFile').onchange = async function(){
  var f = this.files && this.files[0];
  if(!f) return;
  var buf = new Uint8Array(await f.arrayBuffer());
  var from = $('encFrom').value;
  try{
    var text = decodeBytes(buf, from);
    lastDecodedBytes = buf;
    lastDecodedText = text;
    $('encIn').value = text.length > 200000 ? text.slice(0,200000) + '\n…(已截断显示)' : text;
    $('encMsg').textContent = '已读取 ' + f.name + '（' + buf.length + ' 字节，按 ' + from + ' 解码）';
  }catch(e){
    notice('err','读取失败：'+esc(e.message));
  }
  this.value = '';
};
$('encSaveBtn').onclick = function(){
  var v = $('encOut').value;
  if(!v){ notice('warn','没有结果'); return; }
  U.saveBlob(new Blob([v],{type:'text/plain;charset=utf-8'}), '转换结果.txt');
};
})();
