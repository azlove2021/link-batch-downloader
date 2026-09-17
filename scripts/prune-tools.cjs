#!/usr/bin/env node
/* ============================================================================
 * 工具瘦身手术：一次性完成 index.html 的结构调整
 *
 * 目标：35 个工具 → 16 个 + 首页
 *   删除 12 个面板：json / sql / encode / regex / crypto / md / color / time /
 *                  rand / calc / tstat / jwt
 *   合并 5 个面板到保留的工具里（功能不丢）：
 *      pdfcrypt → pdf      （PDF 加密并入 PDF 工具）
 *      hcmp     → hash     （哈希对比并入哈希校验）
 *      crop     → image    （图片裁剪并入图片工具）
 *      stitch   → image    （长图拼接并入图片工具）
 *      outdir   → desk     （统一输出目录并入桌面设置）
 *
 * 同时：重写侧栏导航分组、更新脚本引用、裁切需要保留部分的 JS 文件。
 *
 * 用法： node scripts/prune-tools.cjs            # 预演（只报告，不改动）
 *        node scripts/prune-tools.cjs --apply    # 实际执行
 *
 * 安全：全部改动可用 git 回退；npm test 会校验结果的一致性。
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);
const rm = (p) => fs.unlinkSync(path.join(ROOT, p));
const log = [];

/* ---------------------------------------------------------------- 配置 ---- */
const DELETE_PANELS = ['json', 'sql', 'encode', 'regex', 'crypto', 'md',
                       'color', 'time', 'rand', 'calc', 'tstat', 'jwt'];

const MOVE_PANELS = [
  ['pdfcrypt', 'pdf'],
  ['hcmp', 'hash'],
  ['crop', 'image'],
  ['stitch', 'image'],
  ['outdir', 'desk'],
];

/* 需要删除的 JS 文件（功能已整体移除） */
const DELETE_JS = ['aescrypto.js', 'encode.js', 'json.js', 'office.js',
                   'markdown.js', 'extras.js'];

/* 需要裁切后保留、再删除原文件的 JS */
const RENAME_JS = [['regexdiff.js', 'diff.js']];

const SIDEBAR = `  <nav class="side">
    <a class="nav" data-tool="home"><span class="ic">🏠</span>工具总览</a>

    <div class="grp-t">日常常用</div>
    <a class="nav" data-tool="data"><span class="ic">📊</span>数据工作台</a>
    <a class="nav" data-tool="rename"><span class="ic">✏️</span>批量重命名</a>
    <a class="nav" data-tool="diff"><span class="ic">±</span>文本对比</a>
    <a class="nav" data-tool="convert"><span class="ic">🔄</span>表格互转</a>

    <div class="grp-t">表格与文档</div>
    <a class="nav" data-tool="invoice"><span class="ic">🧾</span>发票提取</a>
    <a class="nav" data-tool="pdf"><span class="ic">📄</span>PDF 工具</a>
    <a class="nav" data-tool="text"><span class="ic">📝</span>文本处理</a>
    <a class="nav" data-tool="image"><span class="ic">🖼️</span>图片工具</a>

    <div class="grp-t">文件与下载</div>
    <a class="nav" data-tool="folder"><span class="ic">🗂</span>文件夹归类</a>
    <a class="nav" data-tool="dl"><span class="ic">📥</span>批量下载</a>
    <a class="nav" data-tool="hash"><span class="ic">🔒</span>哈希校验</a>

    <div class="grp-t">更多</div>
    <a class="nav" data-tool="qr"><span class="ic">▣</span>二维码生成</a>

    <div class="grp-t">桌面增强</div>
    <a class="nav" data-tool="av"><span class="ic">🎬</span>音视频转码</a>
    <a class="nav" data-tool="offconv"><span class="ic">📑</span>Office→PDF</a>
    <a class="nav" data-tool="ocr"><span class="ic">👁</span>图片 OCR</a>
    <a class="nav" data-tool="clean"><span class="ic">🧹</span>大文件清理</a>
    <a class="nav" data-tool="desk"><span class="ic">⚙️</span>桌面设置</a>

    <div class="foot">
      全部数据仅在本机浏览器处理，<br>不会上传到任何服务器。<br>
      推荐 Chrome / Edge。
    </div>
  </nav>`;

/* ------------------------------------------------------- HTML 工具函数 ---- */
/** 返回所有 <section id="tool-X"> 的 {id,start,innerStart,end}（按文档顺序） */
function findSections(html) {
  const re = /<section\b[^>]*>|<\/section>/g;
  const stack = [];
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) {
      const s = stack.pop();
      if (s) out.push({ id: s.id, start: s.start, innerStart: s.innerStart, end: re.lastIndex });
    } else {
      const idm = m[0].match(/id="tool-([^"]+)"/);
      stack.push({ id: idm ? idm[1] : null, start: m.index, innerStart: re.lastIndex });
    }
  }
  return out;
}

function sectionOf(html, id) {
  return findSections(html).find((s) => s.id === id);
}

function removeSection(html, id) {
  const s = sectionOf(html, id);
  if (!s) return html;
  // 顺带删掉紧邻其上的分区注释行，避免留下孤儿注释
  let start = s.start;
  const before = html.slice(0, start);
  const banner = before.match(/(\n[ \t]*<!-- =+ [^\n]*=+ -->\s*)$/);
  if (banner) start -= banner[1].length;
  return html.slice(0, start) + html.slice(s.end);
}

function extractInner(html, id) {
  const s = sectionOf(html, id);
  if (!s) return '';
  return html.slice(s.innerStart, s.end - '</section>'.length);
}

function insertBeforeClose(html, id, content) {
  const s = sectionOf(html, id);
  if (!s) throw new Error('找不到目标 section: ' + id);
  const cut = s.end - '</section>'.length;
  return html.slice(0, cut) + content + html.slice(cut);
}

/* ------------------------------------------------------------------ 主流程 */
log.push('=== 工具瘦身手术 ===' + (APPLY ? '（执行模式）' : '（预演模式）'));

let html = read('index.html');
const before = findSections(html).filter((s) => s.id).map((s) => s.id);
log.push(`起始面板：${before.length} 个`);

/* 1) 合并：先把子面板内容搬进目标面板，再删掉子面板 */
for (const [child, parent] of MOVE_PANELS) {
  if (!sectionOf(html, child)) {
    log.push(`  · 跳过合并 ${child} → ${parent}（源面板不存在）`);
    continue;
  }
  const inner = extractInner(html, child);
  const titleM = inner.match(/<h2 class="th">([^<]*)<\/h2>/);
  const title = titleM ? titleM[1] : child;
  html = removeSection(html, child);
  const wrapped =
    `\n\n        <!-- ↓ 由独立工具合并而来：${title} -->` +
    `\n        <div class="merged">${inner.trim()}\n        </div>\n`;
  html = insertBeforeClose(html, parent, wrapped);
  log.push(`  · 合并 ${child} → ${parent}（标题「${title}」，${inner.trim().length} 字符）`);
}

/* 2) 删除面板 */
for (const id of DELETE_PANELS) {
  if (!sectionOf(html, id)) {
    log.push(`  · 跳过删除 ${id}（不存在）`);
    continue;
  }
  const s = sectionOf(html, id);
  html = removeSection(html, id);
  log.push(`  · 删除面板 ${id}（原 ${s.end - s.start} 字符）`);
}

/* 3) 重写侧栏 */
html = html.replace(/[ \t]*<nav class="side">[\s\S]*?<\/nav>/, SIDEBAR);
log.push('  · 重写侧栏导航（4 个分组）');

/* 4) 脚本引用：删除已删文件、替换改名文件 */
for (const f of DELETE_JS) {
  const tag = new RegExp(`[ \\t]*<script src="js/${f.replace('.', '\\.')}"></script>\\r?\\n?`, 'g');
  if (tag.test(html)) {
    html = html.replace(tag, '');
    log.push(`  · 移除脚本引用 js/${f}`);
  }
}
for (const [from, to] of RENAME_JS) {
  if (html.includes(`js/${from}`)) {
    html = html.replace(new RegExp(`js/${from.replace('.', '\\.')}`, 'g'), `js/${to}`);
    log.push(`  · 脚本引用 js/${from} → js/${to}`);
  }
}
// extra-tools.js 的内容会被拆进 pdf.js / hash.js，不再单独引用
if (html.includes('js/extra-tools.js')) {
  html = html.replace(/[ \t]*<script src="js\/extra-tools\.js"><\/script>\r?\n?/g, '');
  log.push('  · 移除脚本引用 js/extra-tools.js（已拆分并入 pdf.js / hash.js）');
}

const after = findSections(html).filter((s) => s.id).map((s) => s.id);
log.push(`最终面板：${after.length} 个 → ${after.join(', ')}`);

const navCount = (SIDEBAR.match(/data-tool=/g) || []).length;
log.push(`侧栏导航项：${navCount} 个`);

/* ------------------------------------------------------- JS 文件裁切 ---- */
log.push('');
log.push('=== JS 文件处理 ===');

/* diff.js：从 regexdiff.js 中删掉「正则」区块，保留「Diff」区块 */
/* 本脚本是「一次性迁移」：重复执行时会自动跳过已完成的部分，不会互相破坏。 */
const rdPath = path.join(ROOT, 'js/regexdiff.js');
let diffJs = null;
if (fs.existsSync(rdPath)) {
  const rd = read('js/regexdiff.js');
  const regexStart = rd.indexOf('/* ---------- 正则 ---------- */');
  const diffStart = rd.indexOf('/* ---------- Diff');
  diffJs = rd;
  if (regexStart >= 0 && diffStart > regexStart) {
    diffJs = rd.slice(0, regexStart) + rd.slice(diffStart);
    diffJs = diffJs.replace("/* ============ 正则 / Diff ============ */",
                            "/* ============ 文本对比（行级 Diff） ============ */");
    log.push(`  · diff.js：移除「正则」区块 ${diffStart - regexStart} 字符，保留 Diff 区块`);
  }
} else {
  log.push('  · 跳过 diff.js（js/regexdiff.js 已不存在，迁移已完成过）');
}

/* extra-tools.js：拆出「PDF 加密」和「哈希对比」两个 IIFE，并入 pdf.js / hash.js */
const etPath = path.join(ROOT, 'js/extra-tools.js');
const blocks = {};
if (fs.existsSync(etPath)) {
  const et = read('js/extra-tools.js').replace(/^\uFEFF/, '');
  const marker = /\/\* ---------- ([^-]+?) ---------- \*\//g;
  const hits = [];
  let m;
  while ((m = marker.exec(et))) hits.push({ name: m[1].trim(), start: m.index });
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].start : et.length;
    blocks[h.name] = et.slice(h.start, end).trim();
  });
  log.push(`  · extra-tools.js 发现区块：${Object.keys(blocks).join(' / ') || '（无）'}`);
} else {
  log.push('  · 跳过 extra-tools.js（已拆分完成过）');
}

const pdfAdd = blocks['PDF 加密'] || '';
const hcmpAdd = blocks['哈希对比'] || '';

/* ------------------------------------------------------------- 收尾 ---- */
if (APPLY) {
  write('index.html', html);

  if (Object.keys(blocks).length) {
    if (pdfAdd) {
      write('js/pdf.js', read('js/pdf.js').trimEnd() +
        '\n\n/* ======== 由 extra-tools.js 合并：PDF 加密 ======== */\n' + pdfAdd + '\n');
    }
    if (hcmpAdd) {
      write('js/hash.js', read('js/hash.js').trimEnd() +
        '\n\n/* ======== 由 extra-tools.js 合并：哈希对比 ======== */\n' + hcmpAdd + '\n');
    }
    rm('js/extra-tools.js');
    log.push('  · extra-tools.js 已拆入 pdf.js / hash.js 并删除原文件');
  }

  if (diffJs !== null) {
    write('js/diff.js', diffJs);
    rm('js/regexdiff.js');
    log.push('  · 已写出 js/diff.js，删除 js/regexdiff.js');
  }

  for (const f of DELETE_JS) {
    if (fs.existsSync(path.join(ROOT, 'js', f))) {
      rm('js/' + f);
      log.push(`  · 删除 js/${f}`);
    }
  }
  log.push('');
  log.push('已完成。请运行 npm test 校验一致性。');
} else {
  log.push('');
  log.push('预演结束，未改动任何文件。确认无误后加 --apply 执行。');
}

console.log(log.join('\n'));
