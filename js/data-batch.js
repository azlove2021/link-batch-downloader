/* ============ 数据批处理：多表合并 / 按列拆表 ============
 * 这两件事都不是「打开一个表看一眼」，而是把一堆表拼起来或拆开，
 * 所以单独成一个文件；纯逻辑在 js/data-core.js（可在 Node 里跑测试），
 * 解析与导出复用 js/datawork.js 暴露的 TB.datawork 接口。
 */
'use strict';
(function () {
  var U = TB.util;
  var $ = U.$, notice = U.notice, esc = U.esc;
  var C = TB.dataCore || {};

  function dw() {
    if (!TB.datawork) { notice('err', '数据工作台未加载，请刷新页面'); return null; }
    return TB.datawork;
  }

  /* 带 BOM 的 CSV 字节，交给打包器使用 */
  function csvBytes(headers, rows, withHeader) {
    var all = (withHeader === false ? [] : [headers]).concat(rows);
    return new TextEncoder().encode('\ufeff' + U.toCsv(all, ','));
  }

  /* ============================================================ 多表合并 === */
  var mergeFiles = [];
  var mergeResult = null;

  function setMergeInfo(msg) { $('dwMgInfo').textContent = msg; }

  function addMergeFiles(list) {
    var arr = Array.prototype.slice.call(list || []);
    if (!arr.length) return;
    arr.forEach(function (f) {
      /* 同名同大小视为重复选择，避免手滑选两次导致数据翻倍 */
      var dup = mergeFiles.some(function (x) { return x.name === f.name && x.size === f.size; });
      if (!dup) mergeFiles.push(f);
    });
    setMergeInfo('已选 ' + mergeFiles.length + ' 个文件：' +
      mergeFiles.map(function (f) { return f.name; }).join('、').slice(0, 200));
    $('dwMgRun').disabled = mergeFiles.length < 2;
    $('dwMgWarn').textContent = mergeFiles.length < 2 ? '至少选择 2 个文件才能合并' : '';
    $('dwMgExport').disabled = true;
    $('dwMgXlsx').disabled = true;
    $('dwMgLoad').disabled = true;
    mergeResult = null;
    $('dwMgOut').innerHTML = '';
  }

  $('dwMgPick').onclick = function () { $('dwMgFile').click(); };
  $('dwMgDrop').onclick = function (e) {
    if (e.target.tagName !== 'BUTTON') $('dwMgFile').click();
  };
  $('dwMgDrop').addEventListener('dragover', function (e) {
    e.preventDefault(); this.classList.add('over');
  });
  $('dwMgDrop').addEventListener('dragleave', function () { this.classList.remove('over'); });
  $('dwMgDrop').addEventListener('drop', function (e) {
    e.preventDefault(); this.classList.remove('over');
    addMergeFiles(e.dataTransfer.files);
  });
  $('dwMgFile').onchange = function () { addMergeFiles(this.files); this.value = ''; };

  $('dwMgClear').onclick = function () {
    mergeFiles = []; mergeResult = null;
    setMergeInfo('未选择');
    $('dwMgRun').disabled = true;
    $('dwMgExport').disabled = true;
    $('dwMgXlsx').disabled = true;
    $('dwMgLoad').disabled = true;
    $('dwMgWarn').textContent = '';
    $('dwMgOut').innerHTML = '';
  };

  $('dwMgRun').onclick = async function () {
    var API = dw(); if (!API) return;
    if (mergeFiles.length < 2) { notice('warn', '至少选择 2 个文件'); return; }
    var btn = this; btn.disabled = true; btn.textContent = '解析中…';
    try {
      var tables = [], failed = [];
      for (var i = 0; i < mergeFiles.length; i++) {
        try {
          tables.push(await API.parseAnyFile(mergeFiles[i]));
        } catch (e) {
          failed.push(mergeFiles[i].name + '（' + (e.message || e) + '）');
        }
      }
      if (!tables.length) { notice('err', '没有解析成功的文件'); return; }

      var res = C.mergeTables(tables, { addSource: $('dwMgSource').checked, sourceHeader: '来源文件' });
      mergeResult = res;

      var warns = res.warnings.slice();
      if (failed.length) warns.push('解析失败：' + failed.join('；'));
      $('dwMgWarn').innerHTML = warns.length
        ? '<span style="color:#92400e">注意：<br>· ' + warns.map(esc).join('<br>· ') + '</span>'
        : '<span style="color:#15803d">各表表头一致，可直接合并</span>';

      var perTable = res.stats.map(function (s) {
        return s.name + '：' + s.rows.toLocaleString('zh-CN') + ' 行' +
               (s.skipped ? '（跳过 ' + s.skipped + ' 空行）' : '');
      }).join('　·　');

      $('dwMgOut').innerHTML =
        '<div style="margin-bottom:8px"><b>合并结果：' + res.rows.length.toLocaleString('zh-CN') +
        ' 行 × ' + res.headers.length + ' 列</b><div class="muted" style="margin-top:4px">' +
        esc(perTable) + '</div></div>' + C.tableHtml(res.headers, res.rows);

      $('dwMgExport').disabled = false;
      $('dwMgXlsx').disabled = false;
      $('dwMgLoad').disabled = false;
      notice('info', '合并完成：' + res.rows.length.toLocaleString('zh-CN') + ' 行');
    } catch (e) {
      notice('err', '合并失败：' + esc(e.message || e));
      console.error(e);
    } finally {
      btn.disabled = false; btn.textContent = '合并并预览';
    }
  };

  function mergedBaseName() { return '合并结果_' + mergeFiles.length + '表'; }

  $('dwMgExport').onclick = function () {
    if (!mergeResult) { notice('warn', '请先合并'); return; }
    dw().exportRows(mergeResult.headers, mergeResult.rows, mergedBaseName());
  };

  $('dwMgXlsx').onclick = async function () {
    if (!mergeResult) { notice('warn', '请先合并'); return; }
    var btn = this; btn.disabled = true; btn.textContent = '生成中…';
    try {
      U.saveBlob(await U.makeXlsx(mergeResult.headers, mergeResult.rows, '合并结果'), mergedBaseName() + '.xlsx');
      notice('info', '已导出 xlsx');
    } catch (e) {
      notice('err', '导出失败：' + esc(e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '导出 XLSX';
    }
  };

  /* 合并结果直接送进工作台，接着清洗 / 透视 / 比对，不用再存一遍文件 */
  $('dwMgLoad').onclick = function () {
    if (!mergeResult) { notice('warn', '请先合并'); return; }
    dw().setDataset(mergedBaseName() + '（合并）', mergeResult.headers, mergeResult.rows);
    notice('info', '已载入工作台，可继续清洗 / 透视 / 比对');
  };

  /* ============================================================ 按列拆表 === */
  var splitPlan = null;

  function refreshSplitCols() {
    var API = dw(); if (!API) return;
    var DS = API.getDS();
    var sel = $('dwSpCol');
    if (!sel) return;
    var ready = DS.rows.length > 0;
    sel.disabled = !ready;
    $('dwSpRun').disabled = !ready;
    $('dwSpExport').disabled = true;
    if (!ready) {
      sel.innerHTML = '';
      $('dwSpStat').textContent = '先在「数据源」里载入数据';
      return;
    }
    var cur = sel.value;
    sel.innerHTML = DS.headers.map(function (h, i) {
      return '<option value="' + i + '">' + esc(h) + '</option>';
    }).join('');
    if (cur !== '' && +cur < DS.headers.length) sel.value = cur;
    $('dwSpStat').textContent = '当前数据 ' + DS.rows.length.toLocaleString('zh-CN') +
      ' 行 × ' + DS.headers.length + ' 列';
  }

  $('dwSpCol').onchange = function () {
    splitPlan = null; $('dwSpOut').innerHTML = ''; $('dwSpExport').disabled = true;
  };
  $('dwSpFiltered').onchange = refreshSplitCols;

  function rowsForSplit() {
    var DS = dw().getDS();
    /* 先在「数据源」里筛过、再拆，更符合实际用法（只拆看得见的部分） */
    if ($('dwSpFiltered').checked && DS.view && DS.view.length) {
      return DS.view.map(function (i) { return DS.rows[i]; });
    }
    return DS.rows;
  }

  $('dwSpRun').onclick = function () {
    var API = dw(); if (!API) return;
    var DS = API.getDS();
    var ci = +$('dwSpCol').value;
    if (isNaN(ci) || ci < 0 || ci >= DS.headers.length) { notice('warn', '请选择拆分列'); return; }
    var rows = rowsForSplit();
    if (!rows || !rows.length) { notice('warn', '没有可拆分的行'); return; }

    var groups = C.groupRowsBy(rows, ci);
    var names = C.uniqueNames(groups);
    splitPlan = { headers: DS.headers, groups: groups, names: names };

    var total = groups.reduce(function (s, g) { return s + g.count; }, 0);
    $('dwSpStat').innerHTML = '将拆成 <b>' + groups.length + '</b> 个文件，共 ' +
      total.toLocaleString('zh-CN') + ' 行（按列「' + esc(DS.headers[ci]) + '」）';

    var show = Math.min(names.length, 40);
    var h = '<div class="rtable"><table><thead><tr><th>#</th><th>文件名</th><th>行数</th><th>分组值</th></tr></thead><tbody>';
    for (var i = 0; i < show; i++) {
      h += '<tr><td class="muted">' + (i + 1) + '</td><td class="mono">' + esc(names[i].name) +
           '</td><td>' + names[i].count.toLocaleString('zh-CN') +
           '</td><td class="mono">' + esc(names[i].key) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    if (names.length > show) {
      h += '<div class="muted" style="margin-top:6px">仅列出前 ' + show + ' 个，共 ' + names.length + ' 个文件</div>';
    }
    $('dwSpOut').innerHTML = h;
    $('dwSpExport').disabled = false;
  };

  $('dwSpExport').onclick = async function () {
    if (!splitPlan) { notice('warn', '请先预览拆分'); return; }
    var btn = this; btn.disabled = true; btn.textContent = '打包中…';
    try {
      var withHeader = $('dwSpHeader').checked;
      var files = splitPlan.groups.map(function (g, i) {
        return { name: splitPlan.names[i].name, data: csvBytes(splitPlan.headers, g.rows, withHeader) };
      });
      U.saveBlob(await U.makeZip(files), '拆分结果_' + files.length + '个文件.zip');
      notice('info', '已导出 ' + files.length + ' 个 CSV（打包成 ZIP）');
    } catch (e) {
      notice('err', '导出失败：' + esc(e.message || e));
      console.error(e);
    } finally {
      btn.disabled = false; btn.textContent = '导出 ZIP';
    }
  };

  /* 数据载入后刷新拆分列；用自定义事件解耦，datawork.js 不需要知道本文件存在 */
  document.addEventListener('tb:dataset', refreshSplitCols);
  refreshSplitCols();

  TB.dataBatch = { refreshSplitCols: refreshSplitCols };
})();

