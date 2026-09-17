#!/usr/bin/env node
/* ============================================================================
 * 定位并清掉 index.html 里「多余的 </section>」
 *
 * 背景：原始文件就是 35 个 <section> 开 / 36 个 </section> 闭（多一个），
 * 浏览器会静默忽略这个多余闭合标签，所以一直没被发现。它不影响运行，
 * 但会让「标签配对」这类结构校验一直报错，属于该清掉的历史垃圾。
 *
 * 用法： node scripts/fix-orphan-section.cjs            # 只定位报告
 *        node scripts/fix-orphan-section.cjs --apply    # 定位并删除
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'index.html');
const APPLY = process.argv.includes('--apply');
const html = fs.readFileSync(FILE, 'utf8');

/* 用栈配对，找出没有对应开标签的 </section> */
const re = /<section\b[^>]*>|<\/section>/g;
const orphans = [];
const stack = [];
let m;
while ((m = re.exec(html))) {
  if (m[0].startsWith('</')) {
    if (stack.length === 0) orphans.push({ index: m.index, end: re.lastIndex });
    else stack.pop();
  } else {
    stack.push(m.index);
  }
}

const unclosed = stack.length;

function lineOf(index) {
  return html.slice(0, index).split('\n').length;
}

console.log('=== section 标签配对检查 ===');
console.log(`  多余的 </section>：${orphans.length} 个`);
console.log(`  未闭合的 <section>：${unclosed} 个`);

if (unclosed > 0) {
  for (const idx of stack) {
    const ln = lineOf(idx);
    console.log(`  ⚠ 第 ${ln} 行开标签未闭合：${html.slice(idx, idx + 90).split('\n')[0]}`);
  }
}

for (const o of orphans) {
  const ln = lineOf(o.index);
  const lines = html.split('\n');
  console.log(`\n  多余闭合标签位于第 ${ln} 行，上下文：`);
  for (let i = Math.max(0, ln - 4); i < Math.min(lines.length, ln + 2); i++) {
    console.log(`    ${i + 1 === ln ? '>' : ' '} ${i + 1}: ${lines[i].trim().slice(0, 100)}`);
  }
}

if (!orphans.length) {
  console.log('\n无需修复。');
  process.exit(0);
}

if (!APPLY) {
  console.log('\n预演结束，未改动。确认后加 --apply 删除这些多余标签。');
  process.exit(0);
}

/* 从后往前删，避免索引位移 */
let out = html;
for (const o of orphans.slice().sort((a, b) => b.index - a.index)) {
  // 连带该行行首缩进一起删干净
  let start = o.index;
  let lineStart = out.lastIndexOf('\n', start) + 1;
  const indent = out.slice(lineStart, start);
  if (/^[ \t]*$/.test(indent)) start = lineStart;
  out = out.slice(0, start) + out.slice(o.end);
}

fs.writeFileSync(FILE, out);
console.log(`\n已删除 ${orphans.length} 个多余的 </section> 标签。`);
