/* ============ 应用外壳：导航 / 首页搜索 / 兼容检测 ============ */
'use strict';
(function(){
var U = TB.util;
var $ = U.$, notice = U.notice;

/* 兼容徽章 */
(function(){
  var el = $('compat');
  if(U.FS_OK){
    var isCh = /Chrome|Chromium|Edg/.test(navigator.userAgent);
    el.textContent = isCh ? '浏览器兼容 ✓' : '可用（建议 Chrome / Edge）';
  }else{
    el.textContent = '部分功能受限';
    el.className = 'badge bad';
    notice('warn','当前浏览器不支持本地文件夹读写（批量下载/哈希文件夹）。文本/图片/发票/PDF 等工具仍可用。请尽量用 <b>Chrome / Edge</b> 打开。');
  }
})();

var TOOLS = [
  { id:'home', name:'工具总览', desc:'全部工具入口', k:'home 首页 总览 工具' },
  { id:'dl', name:'批量下载', desc:'扫 txt 清单，分目录批量下载，断点续传', k:'download 下载 链接 批量 txt' },
  { id:'hash', name:'哈希校验', desc:'文件/文件夹 SHA-256 / MD5', k:'hash sha md5 校验 摘要' },
  { id:'hcmp', name:'哈希对比', desc:'两文件或两段哈希是否一致', k:'hash compare 对比 一致 sha256' },
  { id:'rename', name:'批量重命名', desc:'规则预览、前缀编号、原地改名', k:'rename 重命名 批量 编号' },
  { id:'text', name:'文本处理', desc:'多行转一行、去重、排序、提取号码链接', k:'text 文本 多行 逗号 去重 提取' },
  { id:'json', name:'JSON 工具', desc:'格式化、压缩、JSON↔CSV', k:'json 格式化 压缩 csv' },
  { id:'sql', name:'SQL 格式化', desc:'本地美化 SQL 语句', k:'sql 格式化 beautify 数据库' },
  { id:'encode', name:'编码转换', desc:'Base64、URL、HTML、GBK/UTF-8', k:'base64 url html gbk utf8 编码' },
  { id:'regex', name:'正则测试', desc:'实时匹配、常用模板', k:'regex 正则 表达式 匹配' },
  { id:'diff', name:'文本对比', desc:'行级 Diff 高亮', k:'diff 对比 差异' },
  { id:'convert', name:'表格互转', desc:'CSV/TSV/JSON/Markdown/Excel', k:'csv tsv 表格 excel markdown 互转' },
  { id:'image', name:'图片工具', desc:'格式转换、压缩、缩放、水印', k:'image 图片 压缩 转换 水印 jpg png webp' },
  { id:'crop', name:'图片裁剪', desc:'框选裁剪、比例锁、导出', k:'crop 裁剪 剪切 图片 比例' },
  { id:'stitch', name:'长图拼接', desc:'多图拼横向/竖向长图', k:'stitch 拼接 长图 合并 图片' },
  { id:'pdf', name:'PDF 工具', desc:'合并、拆分、旋转、页码、提取页', k:'pdf 合并 拆分 旋转 页码 文档' },
  { id:'pdfcrypt', name:'PDF 加密', desc:'加密/解密 PDF 密码', k:'pdf encrypt decrypt 密码 加密 解密' },
  { id:'md', name:'Markdown 编辑器', desc:'分屏预览、草稿、导出 HTML', k:'markdown md 预览 编辑器 草稿' },
  { id:'invoice', name:'发票提取', desc:'发票号码/金额/购销方，导出表格', k:'invoice 发票 报销 税号 金额' },
  { id:'qr', name:'二维码生成', desc:'文本链接转二维码 PNG', k:'qr 二维码 条码' },
  { id:'color', name:'颜色 / 色板', desc:'HEX/RGB/HSL 与图片取色', k:'color 颜色 色板 hex rgb hsl 取色' },
  { id:'time', name:'时间戳', desc:'时间戳与日期互转', k:'timestamp 时间戳 日期 unix' },
  { id:'rand', name:'密码 / UUID', desc:'强密码、UUID、验证码', k:'password uuid 密码 随机 验证码' },
  { id:'calc', name:'房贷 / 利息', desc:'月供、单利复利估算', k:'房贷 月供 利息 复利 计算器 本金' },
  { id:'tstat', name:'文本统计', desc:'字数、行数、阅读时间', k:'字数 统计 行数 阅读' },
  { id:'jwt', name:'JWT 查看', desc:'Header / Payload 本地解析', k:'jwt token 登录 解析' },
  { id:'crypto', name:'AES / HMAC', desc:'AES-GCM 加解密、HMAC 签名', k:'aes hmac 加密 解密 密码 签名 gcm' },
  { id:'outdir', name:'统一输出目录', desc:'导出优先写入常用文件夹', k:'outdir 输出 目录 文件夹 导出' },
  { id:'av', name:'音视频转码', desc:'本机 FFmpeg 转换（桌面版）', k:'ffmpeg 音视频 转码 mp4 mp3 gif 桌面' },
  { id:'offconv', name:'Office→PDF', desc:'LibreOffice 转 PDF（桌面版）', k:'word excel ppt pdf libreoffice office 桌面' },
  { id:'ocr', name:'图片 OCR', desc:'扫描件识别文字（桌面版）', k:'ocr 识别 扫描 发票 桌面' },
  { id:'clean', name:'大文件清理', desc:'扫描大文件进回收站（桌面版）', k:'清理 大文件 c盘 回收站 桌面' },
  { id:'desk', name:'桌面设置', desc:'托盘、右键菜单、依赖检测', k:'托盘 右键 设置 桌面 ffmpeg 检测' }
];

var ICONS = {
  home:'🏠', dl:'📥', hash:'🔒', hcmp:'⚖️', rename:'✏️', text:'📝', json:'{}', sql:'SQL',
  encode:'🔐', regex:'🔍', diff:'±', convert:'🔄', image:'🖼️', crop:'✂️', stitch:'🔗',
  pdf:'📄', pdfcrypt:'🔏', md:'MD', invoice:'🧾', qr:'▣', color:'🎨', time:'⏱', rand:'🎲',
  calc:'🧮', tstat:'📏', jwt:'🪪', crypto:'🗝', outdir:'📂',
  av:'🎬', offconv:'📑', ocr:'👁', clean:'🧹', desk:'⚙️'
};

function toolById(id){
  for (var i=0;i<TOOLS.length;i++) if (TOOLS[i].id === id) return TOOLS[i];
  return null;
}

function buildDash(filter){
  var grid = $('dashGrid');
  grid.innerHTML = '';
  var q = (filter || '').trim().toLowerCase();
  var list = TOOLS.filter(function(t){
    if (t.id === 'home') return !q;
    if (!q) return true;
    var hay = (t.name + ' ' + t.desc + ' ' + t.k).toLowerCase();
    return hay.indexOf(q) >= 0;
  });
  list.forEach(function(t){
    var a = document.createElement('a');
    a.className = 'tile';
    a.href = 'javascript:void(0)';
    a.innerHTML =
      '<div class="ic">'+ICONS[t.id]+'</div>' +
      '<div class="nm">'+t.name+'</div>' +
      '<div class="ds">'+t.desc+'</div>';
    a.onclick = function(){ go(t.id); };
    grid.appendChild(a);
  });
  var hint = $('searchHint');
  if (hint){
    if (q){
      hint.style.display = '';
      hint.textContent = list.length ? ('匹配 ' + list.length + ' 个工具，点击卡片进入') : '没有匹配的工具，试试：pdf / 发票 / base64 / 房贷';
    } else {
      hint.style.display = 'none';
    }
  }
}

function go(id){
  document.querySelectorAll('.side .nav').forEach(function(a){
    a.classList.toggle('on', a.getAttribute('data-tool') === id);
  });
  document.querySelectorAll('.tool').forEach(function(s){
    s.classList.toggle('on', s.id === 'tool-' + id);
  });
  var main = document.querySelector('.main');
  if(main) main.scrollTop = 0;
  try{ location.hash = id === 'home' ? '' : ('#'+id); }catch(e){}
  // 搜索时回首页则清空筛选提示状态，但保留输入
}

document.querySelectorAll('.side .nav').forEach(function(a){
  a.addEventListener('click', function(){ go(a.getAttribute('data-tool')); });
});

var search = $('homeSearch');
if (search){
  search.addEventListener('input', function(){ buildDash(this.value); });
  search.addEventListener('keydown', function(e){
    if (e.key === 'Enter'){
      var first = document.querySelector('#dashGrid .tile');
      if (first) first.click();
    }
  });
  // 侧栏任意处按 / 聚焦搜索
  document.addEventListener('keydown', function(e){
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){
      e.preventDefault();
      go('home');
      search.focus();
      search.select();
    }
  });
}

buildDash('');

(function(){
  var h = (location.hash || '').replace('#','');
  if(h && document.getElementById('tool-'+h)) go(h);
})();
})();
