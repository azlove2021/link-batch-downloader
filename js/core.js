/* ============ 核心工具：通知 / 格式化 / 哈希 / XLSX / ZIP ============ */
'use strict';

window.TB = window.TB || {};

var FS_OK = typeof window.showDirectoryPicker === 'function';

function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function fmtSize(n){
  if(!n) return '0 B';
  var u = ['B','KB','MB','GB','TB'], i = Math.floor(Math.log(n)/Math.log(1024));
  i = Math.min(i, u.length-1);
  return (n/Math.pow(1024,i)).toFixed(i===0?0:(i===1?0:1)) + ' ' + u[i];
}
function fmtSpeed(bps){
  if(!bps) return '—';
  return fmtSize(bps) + '/s';
}
function fmtEta(sec){
  if(!isFinite(sec) || sec < 0) return '—';
  if(sec < 60) return Math.ceil(sec) + ' 秒';
  if(sec < 3600) return Math.floor(sec/60) + ':' + ('0'+Math.ceil(sec%60)).slice(-2);
  return Math.floor(sec/3600) + ':' + ('0'+Math.floor(sec%3600/60)).slice(-2) + ':' + ('0'+Math.ceil(sec%60)).slice(-2);
}
function safeName(s){
  return String(s).replace(/[\\\/:*?"<>|\r\n\t]/g,'_').replace(/\s+/g,' ').trim().slice(0,150);
}
function notice(kind, html){
  var box = document.getElementById('notices');
  if(!box) return;
  while(box.children.length >= 1) box.removeChild(box.firstChild);
  var d = document.createElement('div');
  d.className = 'notice ' + kind;
  d.innerHTML = '<span>'+html+'</span><span class="x">&times;</span>';
  d.querySelector('.x').onclick = function(){ d.remove(); };
  box.appendChild(d);
  if(kind !== 'err') setTimeout(function(){
    if(d.parentNode === box) d.classList.add('hiding');
    setTimeout(function(){ d.parentNode === box && d.remove(); }, 300);
  }, 3500);
}
function saveBlob(blob, name){
  if (TB.outDir && typeof TB.outDir.save === 'function'){
    TB.outDir.save(blob, name).catch(function(){
      var a = document.createElement('a');
      var u = URL.createObjectURL(blob);
      a.href = u; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(u); a.remove(); }, 400);
    });
    return;
  }
  var a = document.createElement('a');
  var u = URL.createObjectURL(blob);
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(u); a.remove(); }, 400);
}
function copyText(txt, okMsg){
  function fallback(){
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.position='fixed'; ta.style.left='-9999px';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); notice('info', okMsg || '已复制'); }
    catch(e){ notice('warn','复制失败，请手动复制'); }
    ta.remove();
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ notice('info', okMsg || '已复制'); }, fallback);
  } else fallback();
}

/* ---------- SHA-256 ---------- */
function bufToHex(buf){
  var u8 = new Uint8Array(buf);
  var hex = '';
  for(var i=0;i<u8.length;i++) hex += u8[i].toString(16).padStart(2,'0');
  return hex;
}
async function sha256Of(file){
  var ab = await file.arrayBuffer();
  var d = await crypto.subtle.digest('SHA-256', ab);
  return bufToHex(d);
}

/* ---------- MD5 (RFC 1321) ---------- */
var MD5 = (function(){
  function add32(a, b){ return (a + b) | 0; }
  function rol(n, c){ return (n << c) | (n >>> (32 - c)); }
  function cmn(q, a, b, x, s, t){ return add32(rol(add32(add32(a, q), add32(x, t)), s), b); }
  function ff(a,b,c,d,x,s,t){ return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a,b,c,d,x,s,t){ return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a,b,c,d,x,s,t){ return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a,b,c,d,x,s,t){ return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function fromAB(ab){
    var u8 = new Uint8Array(ab), len = u8.length;
    var z = (55 - (len & 63) + 64) & 63;
    var padLen = 1 + z;
    var buf = new Uint8Array(len + padLen + 8);
    buf.set(u8, 0);
    buf[len] = 0x80;
    var bitsLo = (len * 8) >>> 0;
    var bitsHi = Math.floor(len / 0x20000000) >>> 0;
    buf[buf.length - 8] = bitsLo & 0xff;
    buf[buf.length - 7] = (bitsLo >>> 8) & 0xff;
    buf[buf.length - 6] = (bitsLo >>> 16) & 0xff;
    buf[buf.length - 5] = (bitsLo >>> 24) & 0xff;
    buf[buf.length - 4] = bitsHi & 0xff;
    buf[buf.length - 3] = (bitsHi >>> 8) & 0xff;
    buf[buf.length - 2] = (bitsHi >>> 16) & 0xff;
    buf[buf.length - 1] = (bitsHi >>> 24) & 0xff;
    var a=1732584193, b=-271733879, c=-1732584194, d=273238508;
    // fix: original used 273238508? RFC uses 0xeb86d391 for d init... keep classic values:
    a=1732584193; b=-271733879; c=-1732584194; d=273238508;
    // Actually correct RFC: A=0x67452301 B=0xEFCDAB89 C=0x98BADCFE D=0x10325476
    a=0x67452301|0; b=0xEFCDAB89|0; c=0x98BADCFE|0; d=0x10325476|0;
    var x = new Int32Array(16);
    for(var j=0;j<buf.length;j+=64){
      for(var k=0;k<16;k++){
        var o = j + k * 4;
        x[k] = (buf[o]) | (buf[o+1]<<8) | (buf[o+2]<<16) | (buf[o+3]<<24);
      }
      var oa=a, ob=b, oc=c, od=d;
      a=ff(a,b,c,d,x[ 0], 7,-680876936); d=ff(d,a,b,c,x[ 1],12,-389564586); c=ff(c,d,a,b,x[ 2],17, 606105819); b=ff(b,c,d,a,x[ 3],22,-1044525330);
      a=ff(a,b,c,d,x[ 4], 7,-176418897); d=ff(d,a,b,c,x[ 5],12, 1200080426); c=ff(c,d,a,b,x[ 6],17,-1473231341); b=ff(b,c,d,a,x[ 7],22,-45705983);
      a=ff(a,b,c,d,x[ 8], 7, 1770035416); d=ff(d,a,b,c,x[ 9],12,-1958414417); c=ff(c,d,a,b,x[10],17,-42063);       b=ff(b,c,d,a,x[11],22,-1990404162);
      a=ff(a,b,c,d,x[12], 7, 1804603682); d=ff(d,a,b,c,x[13],12,-40341101);  c=ff(c,d,a,b,x[14],17,-1502002290);  b=ff(b,c,d,a,x[15],22, 1236535329);
      a=gg(a,b,c,d,x[ 1], 5,-165796510); d=gg(d,a,b,c,x[ 6], 9,-1069501632); c=gg(c,d,a,b,x[11],14, 643717713); b=gg(b,c,d,a,x[ 0],20,-373897302);
      a=gg(a,b,c,d,x[ 5], 5,-701558691); d=gg(d,a,b,c,x[10], 9, 38016083);  c=gg(c,d,a,b,x[15],14,-660478335); b=gg(b,c,d,a,x[ 4],20,-405537848);
      a=gg(a,b,c,d,x[ 9], 5, 568446438); d=gg(d,a,b,c,x[14], 9,-1019803690); c=gg(c,d,a,b,x[ 3],14,-187363961);  b=gg(b,c,d,a,x[ 8],20, 1163531501);
      a=gg(a,b,c,d,x[13], 5,-1444681467); d=gg(d,a,b,c,x[ 2], 9,-51403784);  c=gg(c,d,a,b,x[ 7],14, 1735328473); b=gg(b,c,d,a,x[12],20,-1926607734);
      a=hh(a,b,c,d,x[ 5], 4,-378558); d=hh(d,a,b,c,x[ 8],11,-2022574463); c=hh(c,d,a,b,x[11],16, 1839030562); b=hh(b,c,d,a,x[14],23,-35309556);
      a=hh(a,b,c,d,x[ 1], 4,-1530992060); d=hh(d,a,b,c,x[ 4],11, 1272893353); c=hh(c,d,a,b,x[ 7],16,-155497632); b=hh(b,c,d,a,x[10],23,-1094730640);
      a=hh(a,b,c,d,x[13], 4, 681279174); d=hh(d,a,b,c,x[ 0],11,-358537222); c=hh(c,d,a,b,x[ 3],16,-722521979); b=hh(b,c,d,a,x[ 6],23, 76029189);
      a=hh(a,b,c,d,x[ 9], 4,-640364487); d=hh(d,a,b,c,x[12],11,-421815835); c=hh(c,d,a,b,x[15],16, 530742520); b=hh(b,c,d,a,x[ 2],23,-995338651);
      a=ii(a,b,c,d,x[ 0], 6,-198630844); d=ii(d,a,b,c,x[ 7],10, 1126891415); c=ii(c,d,a,b,x[14],15,-1416354905); b=ii(b,c,d,a,x[ 5],21,-57434055);
      a=ii(a,b,c,d,x[12], 6, 1700485571); d=ii(d,a,b,c,x[ 3],10,-1894986606); c=ii(c,d,a,b,x[10],15,-1051523);    b=ii(b,c,d,a,x[ 1],21,-2054922799);
      a=ii(a,b,c,d,x[ 8], 6, 1873313359); d=ii(d,a,b,c,x[15],10,-30611744);  c=ii(c,d,a,b,x[ 6],15,-1560198380); b=ii(b,c,d,a,x[13],21, 1309151649);
      a=ii(a,b,c,d,x[ 4], 6,-145523070); d=ii(d,a,b,c,x[11],10,-1120210379); c=ii(c,d,a,b,x[ 2],15, 718787259);  b=ii(b,c,d,a,x[ 9],21,-343485551);
      a=add32(a,oa); b=add32(b,ob); c=add32(c,oc); d=add32(d,od);
    }
    return bufToHex(new Uint8Array(new Int32Array([a,b,c,d]).buffer));
  }
  return { fromAB: fromAB };
})();

async function md5OfFile(file){
  if(file.size > 100 * 1024 * 1024){
    throw new Error('文件 ' + fmtSize(file.size) + ' 超过 100MB，请改用 SHA-256');
  }
  var ab = await file.arrayBuffer();
  return MD5.fromAB(ab);
}

/* ---------- CRC32 / ZIP / XLSX ---------- */
var CRC_T = (function(){
  var t = new Uint32Array(256);
  for(var n=0;n<256;n++){
    var c = n;
    for(var k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf){
  var c = 0xFFFFFFFF;
  for(var i=0;i<buf.length;i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function deflateRaw(u8){
  if(typeof CompressionStream === 'undefined') return null;
  var cs = new CompressionStream('deflate-raw');
  var w = cs.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
function u16(v){ return [v & 255, (v>>8)&255]; }
function u32(v){ return [v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255]; }
function dosTime(d){
  return [ ((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()/2|0)) & 255,
           (((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()/2|0))>>8) & 255 ];
}
function dosDate(d){
  var v = ((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  return [v&255,(v>>8)&255];
}
function concat(arrs){
  var n = 0; arrs.forEach(function(a){ n += a.length; });
  var out = new Uint8Array(n), p = 0;
  arrs.forEach(function(a){ out.set(a, p); p += a.length; });
  return out;
}
async function makeZip(files){
  var now = new Date(), tm = dosTime(now), dt = dosDate(now);
  var parts = [], central = [], offset = 0;
  for(var i=0;i<files.length;i++){
    var f = files[i];
    var nameBytes = new TextEncoder().encode(f.name);
    var raw = f.data;
    var comp = await deflateRaw(raw);
    var useDeflate = comp && comp.length < raw.length;
    var data = useDeflate ? comp : raw;
    var crc = crc32(raw), method = useDeflate ? 8 : 0;

    var lh = new Uint8Array([0x50,0x4B,0x03,0x04, 0x14,0x00, 0x00,0x08,
      method&255, (method>>8)&255, tm[0],tm[1], dt[0],dt[1]]);
    lh = concat([lh, new Uint8Array(u32(crc)), new Uint8Array(u32(data.length)),
                 new Uint8Array(u32(raw.length)), new Uint8Array(u16(nameBytes.length)),
                 new Uint8Array([0,0]), nameBytes, data]);
    parts.push(lh);

    var ch = new Uint8Array([0x50,0x4B,0x01,0x02, 0x14,0x00, 0x14,0x00, 0x00,0x08,
      method&255,(method>>8)&255, tm[0],tm[1], dt[0],dt[1]]);
    ch = concat([ch, new Uint8Array(u32(crc)), new Uint8Array(u32(data.length)),
                 new Uint8Array(u32(raw.length)), new Uint8Array(u16(nameBytes.length)),
                 new Uint8Array([0,0,0,0,0,0,0,0]),
                 new Uint8Array(u32(0)), new Uint8Array(u32(offset)),
                 nameBytes]);
    central.push(ch);
    offset += lh.length;
  }
  var cdStart = offset;
  var cd = concat(central);
  var eocd = new Uint8Array([0x50,0x4B,0x05,0x06, 0,0, 0,0]);
  eocd = concat([eocd, new Uint8Array(u16(files.length)), new Uint8Array(u16(files.length)),
                 new Uint8Array(u32(cd.length)), new Uint8Array(u32(cdStart)), new Uint8Array([0,0])]);
  return new Blob([concat(parts), cd, eocd], {type:'application/zip'});
}
function xmlEsc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c];
  }).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
}
function colName(i){
  var s = ''; i++;
  while(i>0){ var m=(i-1)%26; s = String.fromCharCode(65+m)+s; i=(i-m-1)/26; }
  return s;
}
async function makeXlsx(headers, rows, sheetName){
  sheetName = sheetName || 'Sheet1';
  var enc = new TextEncoder();
  var xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  var r1 = '<row r="1">';
  headers.forEach(function(h, i){
    r1 += '<c r="'+colName(i)+'1" t="inlineStr"><is><t>'+xmlEsc(h)+'</t></is></c>';
  });
  xml.push(r1 + '</row>');
  rows.forEach(function(row, ri){
    var rr = ri + 2, s = '<row r="'+rr+'">';
    row.forEach(function(v, ci){
      if(typeof v === 'number' && isFinite(v)){
        s += '<c r="'+colName(ci)+rr+'"><v>'+v+'</v></c>';
      }else{
        s += '<c r="'+colName(ci)+rr+'" t="inlineStr"><is><t>'+xmlEsc(v==null?'':v)+'</t></is></c>';
      }
    });
    xml.push(s + '</row>');
  });
  xml.push('</sheetData></worksheet>');

  var files = [
    { name:'[Content_Types].xml', data:enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'+
      '</Types>') },
    { name:'_rels/.rels', data:enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'+
      '</Relationships>') },
    { name:'xl/workbook.xml', data:enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '+
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<sheets><sheet name="'+xmlEsc(sheetName)+'" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name:'xl/_rels/workbook.xml.rels', data:enc.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'+
      '</Relationships>') },
    { name:'xl/worksheets/sheet1.xml', data:enc.encode(xml.join('')) }
  ];
  return makeZip(files);
}

/* CSV 解析 / 序列化 */
function parseCsv(text, delim){
  delim = delim || ',';
  var rows = [], row = [], cur = '', inQ = false;
  for(var i=0;i<text.length;i++){
    var ch = text[i];
    if(inQ){
      if(ch === '"'){
        if(text[i+1] === '"'){ cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if(ch === '"') inQ = true;
      else if(ch === delim){ row.push(cur); cur = ''; }
      else if(ch === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if(ch === '\r'){ /* skip */ }
      else cur += ch;
    }
  }
  if(cur !== '' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
function toCsv(rows, delim){
  delim = delim || ',';
  return rows.map(function(r){
    return r.map(function(v){
      v = v == null ? '' : String(v);
      if(/[",\n\r]/.test(v)) return '"' + v.replace(/"/g,'""') + '"';
      return v;
    }).join(delim);
  }).join('\n');
}

/* 导出到全局 */
TB.util = {
  $:$, esc:esc, fmtSize:fmtSize, fmtSpeed:fmtSpeed, fmtEta:fmtEta,
  safeName:safeName, notice:notice, saveBlob:saveBlob, copyText:copyText,
  sha256Of:sha256Of, md5OfFile:md5OfFile, MD5:MD5,
  makeXlsx:makeXlsx, makeZip:makeZip, parseCsv:parseCsv, toCsv:toCsv,
  FS_OK:FS_OK
};
TB.FS_OK = FS_OK;
