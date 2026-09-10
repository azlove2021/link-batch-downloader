/* ============ 二维码生成（纯前端，精简实现） ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

/* 基于 Nayuki 风格的紧凑 QR 编码器（byte mode，纠错 L/M/Q/H） */
var QR = (function(){
  var ECC_CODEWORDS_PER_BLOCK = {
    L: [7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    M: [10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    Q: [13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    H: [17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  };
  var NUM_ERROR_CORRECTION_BLOCKS = {
    L: [1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25,25],
    M: [1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49,51],
    Q: [1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68,71],
    H: [1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81,85]
  };

  function getBit(x,i){ return ((x >>> i) & 1) !== 0; }
  function getNumBitsCharCount(ver, ecl){
    var n = ver * 4 + 17;
    return (ver <= 9 ? (ecl==='L'?8:ecl==='M'?8:ecl==='Q'?8:8)
          : ver <= 26 ? (ecl==='L'?16:ecl==='M'?16:ecl==='Q'?16:16)
          : (ecl==='L'?16:ecl==='M'?16:ecl==='Q'?16:16));
  }
  // 简化 bit count for byte mode
  function byteBits(ver){ return ver <= 9 ? 8 : 16; }

  function reedSolomonComputeDivisor(degree){
    var result = [];
    for(var i=0;i<degree-1;i++) result.push(0);
    result.push(1);
    var root = 1;
    for(var i=0;i<degree;i++){
      for(var j=0;j<result.length;j++){
        result[j] = reedSolomonMultiply(result[j], root);
        if(j+1 < result.length) result[j] ^= result[j+1];
      }
      root = reedSolomonMultiply(root, 0x02);
    }
    return result;
  }
  function reedSolomonComputeRemainder(data, divisor){
    var result = divisor.map(function(){ return 0; });
    data.forEach(function(b){
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function(d,i){ result[i] ^= reedSolomonMultiply(d, factor); });
    });
    return result;
  }
  function reedSolomonMultiply(x,y){
    var z = 0;
    for(var i=7;i>=0;i--){
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  function alignPatPositions(ver){
    if(ver === 1) return [];
    var numAlign = Math.floor(ver/7) + 2;
    var step = (ver === 32) ? 26 : Math.ceil((ver*4 + 4) / (numAlign*2 - 2)) * 2;
    var result = [6];
    for(var pos = ver*4 + 10; result.length < numAlign; pos -= step) result.splice(1,0,pos);
    return result;
  }

  function addEccAndInterleave(data, ver, ecl){
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver-1];
    var blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver-1];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var blocks = [];
    var div = reedSolomonComputeDivisor(blockEccLen);
    for(var i=0,k=0;i<numBlocks;i++){
      var dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = reedSolomonComputeRemainder(dat, div);
      if(i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for(var i=0;i<blocks[0].length;i++){
      blocks.forEach(function(block,j){
        if(i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  function getNumRawDataModules(ver){
    var result = (16*ver + 128)*ver + 64;
    if(ver >= 2){
      var numAlign = Math.floor(ver/7) + 2;
      result -= (25*numAlign - 10)*numAlign - 55;
      if(ver >= 7) result -= 36;
    }
    return result;
  }
  function getNumDataCodewords(ver, ecl){
    return Math.floor(getNumRawDataModules(ver)/8)
      - ECC_CODEWORDS_PER_BLOCK[ecl][ver-1] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver-1];
  }

  function formatBits(ecl, mask){
    var eclBits = { L:1, M:0, Q:3, H:2 }[ecl];
    var data = eclBits << 3 | mask;
    var rem = data;
    for(var i=0;i<10;i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (data << 10 | rem) ^ 0x5412;
  }
  function versionBits(ver){
    var rem = ver;
    for(var i=0;i<12;i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return ver << 12 | rem;
  }

  function maskFn(mask, x, y){
    switch(mask){
      case 0: return (x+y)%2===0;
      case 1: return y%2===0;
      case 2: return x%3===0;
      case 3: return (x+y)%3===0;
      case 4: return (Math.floor(x/3)+Math.floor(y/2))%2===0;
      case 5: return x*y%2 + x*y%3 === 0;
      case 6: return (x*y%2 + x*y%3)%2===0;
      case 7: return ((x+y)%2 + x*y%3)%2===0;
    }
    return false;
  }

  function QrCode(ver, ecl, allCodewords){
    var size = ver*4+17;
    var modules = [];
    var isFunction = [];
    for(var i=0;i<size;i++){
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }
    function setFunctionModule(x,y,isDark){
      modules[y][x] = isDark;
      isFunction[y][x] = true;
    }
    // timing
    for(var i=0;i<size;i++){ setFunctionModule(6,i,i%2===0); setFunctionModule(i,6,i%2===0); }
    // finders
    [[3,3],[size-4,3],[3,size-4]].forEach(function(p){
      for(var dy=-4;dy<=4;dy++) for(var dx=-4;dx<=4;dx++){
        var dist = Math.max(Math.abs(dx),Math.abs(dy));
        var xx = p[0]+dx, yy = p[1]+dy;
        if(xx>=0&&xx<size&&yy>=0&&yy<size) setFunctionModule(xx,yy, dist!==2 && dist!==4);
      }
    });
    // alignment
    var alignPos = alignPatPositions(ver);
    var n = alignPos.length;
    for(var i=0;i<n;i++) for(var j=0;j<n;j++){
      if((i===0&&j===0)||(i===0&&j===n-1)||(i===n-1&&j===0)) continue;
      for(var dy=-2;dy<=2;dy++) for(var dx=-2;dx<=2;dx++){
        setFunctionModule(alignPos[j]+dx, alignPos[i]+dy, Math.max(Math.abs(dx),Math.abs(dy))!==1);
      }
    }
    function drawFormatBits(mask){
      var data = formatBits(ecl, mask);
      for(var i=0;i<=5;i++) setFunctionModule(8,i,getBit(data,i));
      setFunctionModule(8,7,getBit(data,6));
      setFunctionModule(8,8,getBit(data,7));
      setFunctionModule(7,8,getBit(data,8));
      for(var i=9;i<15;i++) setFunctionModule(14-i,8,getBit(data,i));
      for(var i=0;i<8;i++) setFunctionModule(size-1-i,8,getBit(data,i));
      for(var i=8;i<15;i++) setFunctionModule(8,size-15+i,getBit(data,i));
      setFunctionModule(8,size-8,true);
    }
    drawFormatBits(0);
    if(ver >= 7){
      var rem = ver;
      for(var i=0;i<12;i++) rem = (rem<<1)^((rem>>>11)*0x1F25);
      var bits = ver<<12|rem;
      for(var i=0;i<18;i++){
        var bit = getBit(bits,i);
        var a = size-11+i%3, b = Math.floor(i/3);
        setFunctionModule(a,b,bit); setFunctionModule(b,a,bit);
      }
    }
    // draw codewords
    var i = 0;
    for(var right=size-1; right>=1; right-=2){
      if(right===6) right=5;
      for(var vert=0; vert<size; vert++){
        for(var j=0;j<2;j++){
          var x = right - j;
          var upward = ((right+1) & 2) === 0;
          var y = upward ? size-1-vert : vert;
          if(!isFunction[y][x] && i < allCodewords.length*8){
            modules[y][x] = getBit(allCodewords[i>>>3], 7 - (i&7));
            i++;
          }
        }
      }
    }
    // mask + penalty
    function applyMask(mask){
      for(var y=0;y<size;y++) for(var x=0;x<size;x++){
        if(!isFunction[y][x] && maskFn(mask,x,y)) modules[y][x] = !modules[y][x];
      }
    }
    function finderPenaltyCountPatterns(rh){
      var n = rh[1];
      var core = n>0 && rh[2]===n && rh[3]===n*3 && rh[4]===n && rh[5]===n;
      return (core && rh[0]>=n*4 && rh[6]>=n ? 1:0) + (core && rh[6]>=n*4 && rh[0]>=n ? 1:0);
    }
    function finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, rh){
      if(currentRunColor){ finderPenaltyAddHistory(currentRunLength, rh); currentRunLength=0; }
      currentRunLength += 7;
      finderPenaltyAddHistory(currentRunLength, rh);
      return finderPenaltyCountPatterns(rh);
    }
    function finderPenaltyAddHistory(currentRunLength, rh){
      if(rh[0]===0) currentRunLength += 7;
      rh.pop(); rh.unshift(currentRunLength);
    }
    function getPenalty(){
      var result = 0;
      for(var y=0;y<size;y++){
        var runColor=false, runX=0, runHistory=[0,0,0,0,0,0,0];
        for(var x=0;x<size;x++){
          if(modules[y][x]===runColor){ runX++; if(runX===5) result+=3; else if(runX>5) result++; }
          else{
            finderPenaltyAddHistory(runX, runHistory);
            if(!runColor) result += finderPenaltyCountPatterns(runHistory)*40;
            runColor = modules[y][x]; runX = 1;
          }
        }
        result += finderPenaltyTerminateAndCount(runColor, runX, runHistory)*40;
      }
      for(var x=0;x<size;x++){
        var runColor=false, runY=0, runHistory=[0,0,0,0,0,0,0];
        for(var y=0;y<size;y++){
          if(modules[y][x]===runColor){ runY++; if(runY===5) result+=3; else if(runY>5) result++; }
          else{
            finderPenaltyAddHistory(runY, runHistory);
            if(!runColor) result += finderPenaltyCountPatterns(runHistory)*40;
            runColor = modules[y][x]; runY = 1;
          }
        }
        result += finderPenaltyTerminateAndCount(runColor, runY, runHistory)*40;
      }
      for(var y=0;y<size-1;y++) for(var x=0;x<size-1;x++){
        var c = modules[y][x];
        if(c===modules[y][x+1] && c===modules[y+1][x] && c===modules[y+1][x+1]) result += 3;
      }
      var dark=0;
      for(var y=0;y<size;y++) for(var x=0;x<size;x++) if(modules[y][x]) dark++;
      var total = size*size;
      var k = Math.ceil(Math.abs(dark*20 - total*10) / total) - 1;
      result += k*10;
      return result;
    }

    var minPenalty = Infinity, bestMask = 0;
    for(var mask=0;mask<8;mask++){
      applyMask(mask); drawFormatBits(mask);
      var p = getPenalty();
      if(p < minPenalty){ minPenalty = p; bestMask = mask; }
      applyMask(mask);
    }
    applyMask(bestMask); drawFormatBits(bestMask);
    return { size:size, modules:modules };
  }

  function encode(text, ecl){
    var bytes = new TextEncoder().encode(text);
    var ver = 1;
    for(ver=1;ver<=40;ver++){
      var capacity = getNumDataCodewords(ver, ecl);
      var ccbits = byteBits(ver);
      var needed = 4 + ccbits + bytes.length*8;
      if(needed <= capacity*8) break;
    }
    if(ver > 40) throw new Error('内容太长，无法生成二维码');
    var dataCapacityBits = getNumDataCodewords(ver, ecl) * 8;
    var bb = [];
    function appendBits(val, len){ for(var i=len-1;i>=0;i--) bb.push((val>>>i)&1); }
    appendBits(4, 4); // byte mode
    appendBits(bytes.length, byteBits(ver));
    bytes.forEach(function(b){ appendBits(b,8); });
    appendBits(0, Math.min(4, dataCapacityBits - bb.length));
    appendBits(0, (8 - bb.length % 8) % 8);
    for(var padByte=0xEC; bb.length < dataCapacityBits; padByte ^= 0xEC ^ 0x11) appendBits(padByte, 8);
    var dataCodewords = [];
    for(var i=0;i<bb.length;i+=8){
      var b=0;
      for(var j=0;j<8;j++) b = (b<<1)|bb[i+j];
      dataCodewords.push(b);
    }
    var all = addEccAndInterleave(dataCodewords, ver, ecl);
    return QrCode(ver, ecl, all);
  }

  return { encode: encode };
})();

function drawQr(){
  try{
    var text = $('qrText').value;
    if(!text){ notice('warn','请输入内容'); return; }
    var ecl = $('qrEc').value;
    var size = parseInt($('qrSize').value, 10) || 220;
    var qr = QR.encode(text, ecl);
    var scale = Math.max(1, Math.floor((size - 20) / qr.size));
    var dim = qr.size * scale;
    var canvas = $('qrCanvas');
    canvas.width = dim + 20;
    canvas.height = dim + 20;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = $('qrBg').value;
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = $('qrFg').value;
    for(var y=0;y<qr.size;y++) for(var x=0;x<qr.size;x++){
      if(qr.modules[y][x]) ctx.fillRect(10 + x*scale, 10 + y*scale, scale, scale);
    }
    notice('info','已生成 ' + qr.size + '×' + qr.size + ' 模块（version ' + ((qr.size-17)/4) + '）');
  }catch(e){
    notice('err', '生成失败：' + e.message);
  }
}

$('qrGen').onclick = drawQr;
$('qrText').addEventListener('keydown', function(e){
  if(e.key==='Enter' && (e.ctrlKey||e.metaKey)) drawQr();
});
$('qrDl').onclick = function(){
  var c = $('qrCanvas');
  c.toBlob(function(b){
    if(b) U.saveBlob(b, 'qrcode.png');
  }, 'image/png');
};
drawQr();
})();
