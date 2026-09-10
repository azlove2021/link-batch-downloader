/* ============ AES-GCM / HMAC 加解密 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice, esc = U.esc;

function enc(s){ return new TextEncoder().encode(s); }
function dec(u8){ return new TextDecoder().decode(u8); }
function toB64(u8){
  var s = '';
  for (var i=0;i<u8.length;i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function fromB64(b){
  var bin = atob(b.replace(/\s+/g,''));
  var u = new Uint8Array(bin.length);
  for (var i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  return u;
}
function toHex(u8){
  return Array.from(u8).map(function(b){ return ('0'+b.toString(16)).slice(-2); }).join('');
}
function fromHex(h){
  h = h.replace(/\s+/g,'');
  if (h.length % 2) throw new Error('十六进制长度必须为偶数');
  var u = new Uint8Array(h.length/2);
  for (var i=0;i<u.length;i++) u[i] = parseInt(h.substr(i*2,2),16);
  return u;
}

async function deriveKey(password, salt, iterations){
  var base = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: salt, iterations: iterations || 100000, hash:'SHA-256' },
    base,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}

$('aesEncrypt').onclick = async function(){
  var text = $('aesIn').value;
  var pass = $('aesPass').value;
  if (!text){ notice('warn','请输入明文'); return; }
  if (!pass || pass.length < 6){ notice('warn','密码至少 6 位'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '加密中…';
  try{
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var iter = parseInt($('aesIter').value, 10) || 100000;
    var key = await deriveKey(pass, salt, iter);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv: iv }, key, enc(text)));
    // layout: base64(salt || iv || ct)  with header comment
    var pack = new Uint8Array(salt.length + iv.length + ct.length);
    pack.set(salt, 0); pack.set(iv, salt.length); pack.set(ct, salt.length + iv.length);
    $('aesOut').value = toB64(pack);
    $('aesMeta').textContent = 'AES-256-GCM · PBKDF2-SHA256 · ' + iter + ' 次 · salt16+iv12+ct · 输出 Base64';
    notice('info','加密完成');
  }catch(e){
    notice('err','加密失败：' + esc(e.message));
  }finally{
    btn.disabled = false; btn.textContent = '加密 →';
  }
};

$('aesDecrypt').onclick = async function(){
  var b = $('aesIn').value.trim();
  var pass = $('aesPass').value;
  if (!b){ notice('warn','请输入密文'); return; }
  if (!pass){ notice('warn','请输入密码'); return; }
  var btn = this; btn.disabled = true; btn.textContent = '解密中…';
  try{
    var pack = fromB64(b);
    if (pack.length < 16+12+1) throw new Error('密文太短或格式不对');
    var salt = pack.subarray(0,16);
    var iv = pack.subarray(16,28);
    var ct = pack.subarray(28);
    var iter = parseInt($('aesIter').value, 10) || 100000;
    var key = await deriveKey(pass, salt, iter);
    var pt = await crypto.subtle.decrypt({ name:'AES-GCM', iv: iv }, key, ct);
    $('aesOut').value = dec(new Uint8Array(pt));
    $('aesMeta').textContent = '解密成功';
    notice('info','解密完成');
  }catch(e){
    $('aesOut').value = '';
    $('aesMeta').textContent = '解密失败（密码错误或数据损坏）';
    notice('err','解密失败：密码错误或密文损坏');
  }finally{
    btn.disabled = false; btn.textContent = '← 解密';
  }
};

$('aesSwap').onclick = function(){
  var a = $('aesIn').value;
  $('aesIn').value = $('aesOut').value;
  $('aesOut').value = a;
};
$('aesClear').onclick = function(){
  $('aesIn').value = ''; $('aesOut').value = ''; $('aesPass').value = ''; $('aesMeta').textContent = '';
};
$('aesCopy').onclick = function(){ U.copyText($('aesOut').value); };

/* ---------- HMAC ---------- */
function parseHexKey(){
  var mode = $('hmacKeyMode').value;
  if (mode === 'hex') return fromHex($('hmacKey').value.trim());
  return enc($('hmacKey').value);
}

$('hmacRun').onclick = async function(){
  var data = $('hmacIn').value;
  var key = $('hmacKey').value;
  if (!data){ notice('warn','请输入消息'); return; }
  if (!key){ notice('warn','请输入密钥'); return; }
  var algo = $('hmacAlgo').value; // SHA-256 | SHA-1 | SHA-384 | SHA-512
  try{
    var keyBytes = parseHexKey();
    var k = await crypto.subtle.importKey('raw', keyBytes, { name:'HMAC', hash: algo }, false, ['sign']);
    var sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc(data)));
    $('hmacOut').value = toHex(sig);
    $('hmacMeta').textContent = 'HMAC-' + algo.replace('SHA-','') + ' · ' + sig.length + ' 字节 · 小写 Hex';
  }catch(e){
    notice('err','计算失败：' + esc(e.message));
  }
};
$('hmacClear').onclick = function(){
  $('hmacIn').value = ''; $('hmacKey').value = ''; $('hmacOut').value = ''; $('hmacMeta').textContent = '';
};
$('hmacCopy').onclick = function(){ U.copyText($('hmacOut').value); };
$('hmacKeyMode').onchange = function(){
  $('hmacKeyHint').textContent = this.value === 'hex'
    ? '密钥按十六进制解析（如 6b6579…）'
    : '密钥按 UTF-8 文本解析';
};
})();
