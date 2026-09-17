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

/* tier：1 = 日常常用（首页大卡） / 2 = 偶尔用 / 3 = 更多（默认折叠）
   grp ：侧栏里的分组（见下方 GRP_ORDER）——侧栏菜单由这里生成，不再手写 */
var TOOLS = [
  { id:'home', name:'工具总览', desc:'全部工具入口', k:'home 首页 总览 工具', tier:0, grp:'' },

  { id:'data', name:'数据工作台', desc:'多表合并、清洗、按列拆表、对账、透视', k:'csv excel 数据 分析 清洗 对账 比对 表格 透视 汇总 合并 拆分 整理', tier:1, grp:'数据与表格' },
  { id:'rename', name:'批量重命名', desc:'日期提取、规则预览、可撤销、有记录', k:'rename 重命名 批量 编号 文件名 扫描件 日期', tier:1, grp:'文件与整理' },
  { id:'diff', name:'文本对比', desc:'行级 Diff 高亮，快速找差异', k:'diff 对比 差异 比较 两份 找出不同', tier:1, grp:'数据与表格' },
  { id:'convert', name:'表格互转', desc:'CSV/TSV/JSON/Markdown/Excel', k:'csv tsv 表格 excel markdown json 互转 转换', tier:1, grp:'数据与表格' },

  { id:'invoice', name:'发票提取', desc:'图片OCR、号码/金额/购销方、重复检测、台账比对', k:'invoice 发票 报销 税号 金额 对账 ocr 识别 图片 重复 台账', tier:2, grp:'办公实用' },
  { id:'pdf', name:'PDF 工具', desc:'合并、拆分、旋转、页码、加密码', k:'pdf 合并 拆分 旋转 页码 文档 密码 加密', tier:2, grp:'格式转换' },
  { id:'text', name:'文本处理', desc:'去重、排序、多行转一行、提取号码链接、脱敏打码、粘贴清洗', k:'text 文本 多行 逗号 去重 提取 清洗 换行 脱敏 打码 手机号 身份证 邮箱 全角 半角 零宽', tier:2, grp:'数据与表格' },
  { id:'image', name:'图片工具', desc:'压缩转换、压到指定KB、裁剪、长图拼接', k:'image 图片 压缩 转换 水印 裁剪 拼接 长图 kb 指定大小', tier:2, grp:'格式转换' },
  { id:'folder', name:'文件夹归类', desc:'按扩展名/日期/关键字自动归子文件夹', k:'文件夹 归类 整理 发票 周报 自动', tier:2, grp:'文件与整理' },
  { id:'dl', name:'批量下载', desc:'扫 txt 清单，分目录批量下载，预检/自定义头/续传/失败重跑', k:'download 下载 链接 批量 txt cookie header 请求头 预检 探测 失败 重跑 防盗链', tier:2, grp:'文件与整理' },
  { id:'hash', name:'哈希校验', desc:'文件/文件夹 SHA-256 / MD5，可对比', k:'hash sha md5 校验 摘要 对比 一致', tier:2, grp:'文件与整理' },

  { id:'qr', name:'二维码生成', desc:'文本链接转二维码 PNG', k:'qr 二维码 条码', tier:3, grp:'办公实用' },
  { id:'av', name:'音视频转码', desc:'本机 FFmpeg 转换（桌面版）', k:'ffmpeg 音视频 转码 mp4 mp3 gif 桌面', tier:3, grp:'格式转换' },
  { id:'offconv', name:'Office→PDF', desc:'LibreOffice 转 PDF（桌面版）', k:'word excel ppt pdf libreoffice office 桌面', tier:3, grp:'格式转换' },
  { id:'ocr', name:'图片 OCR', desc:'扫描件识别文字（桌面版）', k:'ocr 识别 扫描 发票 桌面', tier:3, grp:'办公实用' },
  { id:'clean', name:'大文件清理', desc:'扫描大文件进回收站（桌面版）', k:'清理 大文件 c盘 回收站 桌面', tier:3, grp:'办公实用' },
  { id:'desk', name:'桌面设置', desc:'托盘、右键菜单、依赖检测、输出目录', k:'托盘 右键 设置 桌面 ffmpeg 检测 输出目录', tier:3, grp:'办公实用' }
];

var ICONS = {
  home:'🏠', data:'📊', rename:'✏️', diff:'±', convert:'🔄',
  invoice:'🧾', pdf:'📄', text:'📝', image:'🖼️', folder:'🗂', dl:'📥', hash:'🔒',
  qr:'▣', av:'🎬', offconv:'📑', ocr:'👁', clean:'🧹', desk:'⚙️'
};

/* 侧栏分组顺序：只影响排列，不影响功能 */
var GRP_ORDER = ['数据与表格', '文件与整理', '格式转换', '办公实用'];

function toolById(id){
  for (var i=0;i<TOOLS.length;i++) if (TOOLS[i].id === id) return TOOLS[i];
  return null;
}

/* 侧栏由 TOOLS 生成：加工具、删工具都不必再改 HTML
   （以前是手写菜单，删掉工具后菜单里还留着点进去空白的老入口） */
function buildSide(){
  var nav = $('sideNav');
  if (!nav) return;
  var html = '<div class="grp-t">首页</div>' +
    '<a class="nav" data-tool="home"><span class="ic">' + (ICONS.home || '🏠') + '</span>工具总览</a>';
  GRP_ORDER.forEach(function(g){
    var list = TOOLS.filter(function(t){ return t.grp === g; })
                    .sort(function(a, b){ return a.tier - b.tier; });
    if (!list.length) return;
    html += '<div class="grp-t">' + g + '</div>';
    list.forEach(function(t){
      html += '<a class="nav" data-tool="' + t.id + '"><span class="ic">' +
              (ICONS[t.id] || '·') + '</span>' + t.name + '</a>';
    });
  });
  var box = document.createElement('div');
  box.innerHTML = html;
  var foot = nav.querySelector('.foot');
  Array.prototype.slice.call(box.childNodes).forEach(function(n){
    nav.insertBefore(n, foot);   // foot 为 null 时等价于追加到末尾
  });
  nav.querySelectorAll('a.nav').forEach(function(a){
    a.addEventListener('click', function(){ go(a.getAttribute('data-tool')); });
  });
  /* 没归组的工具会从侧栏消失（首页还能搜到），这里明确提醒，避免以后又漏 */
  var loose = TOOLS.filter(function(t){ return t.id !== 'home' && GRP_ORDER.indexOf(t.grp) < 0; });
  if (loose.length){
    notice('warn', '这些工具没归到侧栏分组，只能在首页找到：' +
      loose.map(function(t){ return t.name; }).join('、'));
  }
}

function toolCard(t, big){
  var a = document.createElement('a');
  a.className = 'tile' + (big ? ' big' : '');
  a.href = 'javascript:void(0)';
  a.innerHTML =
    '<div class="ic">'+(ICONS[t.id] || '·')+'</div>' +
    '<div class="nm">'+t.name+'</div>' +
    '<div class="ds">'+t.desc+'</div>';
  a.onclick = function(){ go(t.id); };
  return a;
}

function groupTitle(text){
  var h = document.createElement('div');
  h.className = 'dash-grp';
  h.textContent = text;
  return h;
}

/* 首页按使用频率分层：日常常用（大卡）→ 偶尔用 → 更多（默认折叠） */
function buildDash(filter){
  var grid = $('dashGrid');
  grid.innerHTML = '';
  var q = (filter || '').trim().toLowerCase();
  var list = TOOLS.filter(function(t){
    if (t.id === 'home') return false;
    if (!q) return true;
    var hay = (t.name + ' ' + t.desc + ' ' + t.k).toLowerCase();
    return hay.indexOf(q) >= 0;
  });

  if (q){
    /* 搜索：不分层，直接平铺结果 */
    list.forEach(function(t){ grid.appendChild(toolCard(t, false)); });
  } else {
    var groups = [
      { title:'日常常用', tier:1, big:true },
      { title:'偶尔用', tier:2, big:false },
      { title:'更多工具（桌面增强 / 低频）', tier:3, big:false, collapsed:true }
    ];
    groups.forEach(function(g){
      var items = list.filter(function(t){ return t.tier === g.tier; });
      if (!items.length) return;
      grid.appendChild(groupTitle(g.title));
      items.forEach(function(t){
        var card = toolCard(t, g.big);
        if (g.collapsed) card.classList.add('more-tile');
        card.style.display = g.collapsed ? 'none' : '';
        grid.appendChild(card);
      });
    });
    /* 「展开更多」按钮：只在有折叠项且非搜索状态时出现 */
    var hasMore = list.some(function(t){ return t.tier === 3; });
    if (hasMore){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'dashMoreBtn';
      btn.className = 'sm more-btn';
      btn.textContent = '展开更多工具 ▾';
      btn.onclick = function(){
        var tiles = grid.querySelectorAll('.more-tile');
        var open = tiles.length && tiles[0].style.display === 'none';
        for (var i = 0; i < tiles.length; i++){
          tiles[i].style.display = open ? '' : 'none';
        }
        btn.textContent = open ? '收起 ▴' : '展开更多工具 ▾';
      };
      grid.appendChild(btn);
    }
  }

  var hint = $('searchHint');
  if (hint){
    if (q){
      hint.style.display = '';
      hint.textContent = list.length
        ? ('匹配 ' + list.length + ' 个工具，点击卡片进入')
        : '没有匹配的工具，试试：表格 / 发票 / pdf / 改名 / 对比';
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

buildSide();

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

