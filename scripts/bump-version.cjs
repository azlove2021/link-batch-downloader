#!/usr/bin/env node
/* ============================================================================
 * 统一版本号：package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json
 *
 * 背景：这三个文件各自维护版本号，之前已经漂移过（package.json 1.0.0，
 *       另外两个 1.1.0）。此脚本一次改齐，避免再出现不一致。
 *
 * 用法： node scripts/bump-version.cjs 1.2.0
 *        node scripts/bump-version.cjs          # 只检查，不改
 * ==========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const next = process.argv[2];

const TARGETS = [
  { file: 'package.json', re: /("version"\s*:\s*")[^"]+(")/ },
  { file: 'src-tauri/tauri.conf.json', re: /("version"\s*:\s*")[^"]+(")/ },
  { file: 'src-tauri/Cargo.toml', re: /(^version\s*=\s*")[^"]+(")/m },
];

function currentVersion(src, re) {
  const m = re.exec(src);
  if (!m) return null;
  // m[1] 以开引号结尾，其后到下一个引号之间就是版本号
  const after = src.slice(m.index + m[1].length);
  const end = after.indexOf('"');
  return end >= 0 ? after.slice(0, end) : null;
}

if (next && !/^\d+\.\d+\.\d+([-.+].*)?$/.test(next)) {
  console.error('版本号格式不对。示例：node scripts/bump-version.cjs 1.2.0');
  process.exit(1);
}

const found = [];
let changed = 0;

for (const t of TARGETS) {
  const p = path.join(ROOT, t.file);
  if (!fs.existsSync(p)) {
    console.log(`跳过（文件不存在）：${t.file}`);
    continue;
  }
  const before = fs.readFileSync(p, 'utf8');
  const cur = currentVersion(before, t.re);
  if (!cur) {
    console.log(`跳过（没找到 version 字段）：${t.file}`);
    continue;
  }
  found.push({ file: t.file, version: cur });

  if (!next) continue;

  if (cur === next) {
    console.log(`· ${t.file} 已是 ${next}`);
    continue;
  }
  const after = before.replace(t.re, '$1' + next + '$2');
  fs.writeFileSync(p, after);
  console.log(`✓ ${t.file}  ${cur} → ${next}`);
  changed++;
}

console.log('');
if (!next) {
  console.log('当前版本号：');
  for (const f of found) console.log(`  ${f.version.padEnd(10)} ${f.file}`);
  const allSame = found.length > 1 && found.every((f) => f.version === found[0].version);
  if (!allSame) {
    console.log('\n⚠ 三处版本号不一致。运行 node scripts/bump-version.cjs <版本> 统一。');
    process.exit(1);
  }
  console.log('\n✓ 版本号一致');
} else {
  console.log(changed ? `完成：更新了 ${changed} 个文件` : '无需改动');
}
