#!/usr/bin/env node
/* ============================================================================
 * 批量下载 · 纯函数单元测试（请求头解析 / 失败清单）
 *
 * 请求头：禁止头必须被拦下并提示（浏览器会静默丢弃，用户以为生效了其实没有）；
 * 失败清单：导出的 txt 必须能被 parseTxt 原样再导入，格式不能自由发挥。
 *
 * 运行： npm test（会连同一致性校验一起跑）
 * ==========================================================================*/
'use strict';

const path = require('path');

/* 让浏览器风格的 IIFE 能在 Node 里加载 */
global.window = global;
require(path.join(__dirname, '..', 'js', 'download-core.js'));
const DC = global.TB.downloadCore;

let pass = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${label}\n      期望 ${e}\n      实际 ${a}`);
}

/* ---------------------------------------------------------------- 请求头解析 */
eq(DC.parseHeaders('Authorization: Bearer abc\nX-Api-Key: 123').headers,
   { 'Authorization': 'Bearer abc', 'X-Api-Key': '123' }, '常规头解析（值可含空格）');
eq(DC.parseHeaders('X-Callback: https://a.com/x').headers,
   { 'X-Callback': 'https://a.com/x' }, '值是 URL：只在第一个冒号处切分');
eq(DC.parseHeaders('# 注释\n\n// 也是注释\nA: 1').headers, { A: '1' }, '注释与空行忽略');
eq(DC.parseHeaders('没有冒号的垃圾行').headers, {}, '无冒号行忽略');
eq(DC.parseHeaders('A: 1\nA: 2').headers, { A: '2' }, '重名后者覆盖');
eq(DC.parseHeaders('A:').headers, {}, '空值忽略');

const ck = DC.parseHeaders('Cookie: session=abc; uid=9');
eq(ck.cookieWanted, true, '写 Cookie → cookieWanted（UI 转 credentials 模式）');
eq(ck.headers, {}, 'Cookie 不进入生效头');
eq(ck.forbidden.length, 1, 'Cookie 进禁止清单');

const fb = DC.parseHeaders('Referer: https://x.com\nUser-Agent: curl\nSec-Fetch-Mode: cors\nProxy-A: 1\nAccept: */*');
eq(fb.forbidden.map((f) => f.name), ['Referer', 'User-Agent', 'Sec-Fetch-Mode', 'Proxy-A'],
   'Referer / UA / sec-* / proxy-* 全拦截');
eq(fb.headers, { 'Accept': '*/*' }, '合法头保留');

/* ---------------------------------------------------------------- 失败清单 */
eq(DC.failListTxt([{ title: '报告 一', url: 'https://a/1.pdf' }, { url: 'https://a/2' }]),
   '报告 一\thttps://a/1.pdf\r\nhttps://a/2\r\n', '标题+TAB+链接，CRLF 结尾');
eq(DC.failListTxt([{ title: '多\n行\t标题', url: 'https://a/3' }]),
   '多 行 标题\thttps://a/3\r\n', '标题里的换行/Tab 压平（防止破坏一行一条）');
eq(DC.failListTxt([{ title: '', url: 'https://a/4' }]), 'https://a/4\r\n', '无标题只有链接');
eq(DC.failListTxt([]), '', '空列表得空串');
eq(DC.failListTxt([null, { title: 'x' }]), '', '脏数据不崩溃');

/* ---------------------------------------------------------------- 输出 */
console.log('');
console.log(`download-core 单元测试：${pass + failures.length} 项，通过 ${pass} 项`);
if (failures.length) {
  console.error(`✗ 失败 ${failures.length} 项：`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('✓ 全部通过：请求头解析 / 失败清单');
