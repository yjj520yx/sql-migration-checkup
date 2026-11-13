(function () {
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    input: $('sqlInput'),
    charCount: $('charCount'),
    run: $('runBtn'),
    clear: $('clearBtn'),
    exportBtn: $('exportBtn'),
    rulesBtn: $('rulesBtn'),
    status: $('status'),
    summary: $('summary'),
    diffSection: $('diffSection'),
    issuesSection: $('issuesSection'),
    paneLeft: $('paneLeft'),
    paneRight: $('paneRight'),
    leftCount: $('leftCount'),
    issueList: $('issueList'),
    issueCount: $('issueCount'),
    noIssueTip: $('noIssueTip'),
    sameTip: $('sameTip'),
    onlyHigh: $('onlyHigh'),
    samples: $('samples'),
    copyBtn: $('copyBtn'),
    rulesModal: $('rulesModal'),
    rulesTable: $('rulesTable'),
    modalClose: $('modalClose'),
    klToggle: $('klToggle'),
    klMore: $('klMore'),
    ruleCountFooter: $('ruleCountFooter')
  };

  var state = { dir: 'oracle', result: null, input: '', timer: null };
  var DIR_LABEL = { oracle: 'Oracle → 达梦（DM8）', mysql: 'MySQL → 达梦（DM8）' };

  function setStatus(text) { els.status.textContent = text; }

  function renderSamples() {
    SAMPLES.forEach(function (s) {
      var b = document.createElement('button');
      b.className = 'sample-btn';
      b.type = 'button';
      b.textContent = s.name;
      b.title = s.desc;
      b.addEventListener('click', function () {
        state.dir = s.dir;
        syncDirButtons();
        els.input.value = s.sql;
        updateCharCount();
        run();
        els.input.focus();
      });
      els.samples.appendChild(b);
    });
  }

  function syncDirButtons() {
    var btns = document.querySelectorAll('.dir-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var on = b.getAttribute('data-dir') === state.dir;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  function updateCharCount() {
    var n = els.input.value.length;
    els.charCount.textContent = n.toLocaleString('zh-CN') + ' 字符';
  }

  function clearOutputs() {
    state.result = null;
    els.summary.hidden = true;
    els.diffSection.hidden = true;
    els.issuesSection.hidden = true;
    els.exportBtn.disabled = true;
    els.summary.innerHTML = '';
    els.issueList.innerHTML = '';
    els.sameTip.hidden = true;
  }

  function run() {
    var sql = els.input.value;
    updateCharCount();
    if (!sql.trim()) {
      clearOutputs();
      setStatus('请输入 SQL，或点上方样例一键载入');
      return;
    }
    if (sql.length > 200000) {
      clearOutputs();
      setStatus('SQL 超过 20 万字符，请拆分后再试');
      return;
    }
    var res;
    try {
      res = Converter.convert(sql, state.dir);
    } catch (e) {
      clearOutputs();
      setStatus('转换失败：' + (e && e.message ? e.message : '未知错误'));
      return;
    }
    if (!res.ok) {
      clearOutputs();
      setStatus(res.error || '转换失败');
      return;
    }
    state.result = res;
    state.input = sql;
    renderSummary(res);
    renderDiff(sql, res.output);
    renderIssues(res);
    var unchanged = sql.replace(/\r\n?/g, '\n').trim() === res.output.trim();
    els.sameTip.hidden = !unchanged;
    if (unchanged) {
      els.sameTip.textContent = '改写结果与原 SQL 相同：这段写法在达梦上基本通用，没有可直接替换的部分，重点看下方问题清单里需要人工确认的项。';
    }
    els.exportBtn.disabled = false;
    var tip = '已体检 · ' + res.stats.total + ' 条问题 · ' +
      Converter.ruleCount(state.dir) + ' 条规则 · ' + res.elapsed + 'ms';
    if (res.failedRules && res.failedRules.length) {
      tip += ' · ' + res.failedRules.length + ' 条规则执行异常已跳过';
    }
    setStatus(tip);
  }

  function renderSummary(res) {
    var s = res.stats;
    els.summary.innerHTML = [
      '<div class="sum-item high"><b>' + s.high + '</b><span>高危</span></div>',
      '<div class="sum-item medium"><b>' + s.medium + '</b><span>中危</span></div>',
      '<div class="sum-item low"><b>' + s.low + '</b><span>低危</span></div>',
      '<div class="sum-item"><b>' + s.total + '</b><span>问题合计</span></div>',
      '<div class="sum-item"><b>' + res.output.length.toLocaleString('zh-CN') + '</b><span>改写后字符</span></div>'
    ].join('');
    els.summary.hidden = false;
  }

  function buildPane(rows, side) {
    var html = '';
    var lineNo = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var text = side === 'left' ? r.left : r.right;
      if (text === null) {
        html += '<div class="diff-row"><span class="ln"></span><div class="code-cell"> </div></div>';
        continue;
      }
      lineNo++;
      var cls = 'eq';
      if (side === 'left') {
        cls = r.type === 'eq' ? 'eq' : (r.type === 'ins' ? 'empty' : 'del');
      } else {
        cls = r.type === 'eq' ? 'eq' : (r.type === 'del' ? 'empty' : 'add');
      }
      var content;
      if (r.type === 'mod') {
        var pair = Converter.wordDiff(r.left, r.right);
        content = side === 'left' ? pair[0] : pair[1];
      } else {
        content = Converter.escapeHtml(text) || ' ';
      }
      html += '<div class="diff-row row-' + cls + '"><span class="ln">' + lineNo +
        '</span><div class="code-cell">' + content + '</div></div>';
    }
    return html;
  }

  function renderDiff(input, output) {
    var rows = Converter.diffRows(input, output);
    els.paneLeft.innerHTML = buildPane(rows, 'left');
    els.paneRight.innerHTML = buildPane(rows, 'right');
    els.leftCount.textContent = ' · ' + input.split('\n').length + ' 行';
    els.diffSection.hidden = false;
  }

  function riskLabel(r) {
    return r === 'high' ? '高危' : r === 'medium' ? '中危' : '低危';
  }

  function renderIssues(res) {
    var list = res.issues.filter(function (it) {
      return !els.onlyHigh.checked || it.risk === 'high';
    });
    els.issueCount.textContent = list.length === res.issues.length
      ? '共 ' + res.issues.length + ' 条'
      : '显示 ' + list.length + ' / ' + res.issues.length + ' 条';
    if (list.length === 0) {
      els.issueList.innerHTML = '';
      els.noIssueTip.textContent = res.issues.length > 0
        ? '当前筛选下没有问题。取消「只标高危」可查看其余 ' + res.issues.length + ' 条。'
        : '没有发现需要处理的问题。这通常意味着写法在达梦上基本通用，仍建议在目标库实测一次。';
      els.noIssueTip.hidden = false;
      els.issuesSection.hidden = false;
      return;
    }
    els.noIssueTip.hidden = true;
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      html += '<div class="issue">' +
        '<div class="issue-top">' +
          '<span class="risk ' + it.risk + '">' + riskLabel(it.risk) + '</span>' +
          '<span class="issue-name">' + Converter.escapeHtml(it.name) +
            (it.count > 1 ? '（共 ' + it.count + ' 处）' : '') + '</span>' +
          (it.confirm ? '<span class="tag confirm">需人工确认</span>' : '<span class="tag">可直接改写</span>') +
          '<span class="issue-line">第 ' + it.line + ' 行</span>' +
        '</div>' +
        '<div class="issue-code">' +
          '<pre class="before">' + (it.before ? Converter.escapeHtml(it.before) : '（无原文）') + '</pre>' +
          '<pre class="after">' + (it.after ? Converter.escapeHtml(it.after) : '（移除该写法）') + '</pre>' +
        '</div>' +
        '<p class="issue-why"><b>为什么：</b>' + Converter.escapeHtml(it.why) +
          (it.note ? '<br><b>风险说明：</b>' + Converter.escapeHtml(it.note) : '') + '</p>' +
      '</div>';
    }
    els.issueList.innerHTML = html;
    els.issuesSection.hidden = false;
  }

  function exportMarkdown() {
    if (!state.result) return;
    var md = Converter.buildReport(state.input, state.result, DIR_LABEL[state.dir], new Date());
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var name = 'SQL迁移体检报告_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + '.md';
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    setStatus('已导出 ' + name);
  }

  function copyOutput() {
    if (!state.result) return;
    var text = state.result.output;
    var done = function () { setStatus('改写后的 SQL 已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { setStatus('复制失败，请手动选中'); }
      document.body.removeChild(ta);
    }
  }

  function renderRuleTable() {
    var rows = ['<table class="rules-table"><thead><tr><th>规则</th><th>方向</th><th>等级</th><th>类型</th><th>说明</th></tr></thead><tbody>'];
    Converter.rules.forEach(function (r) {
      var dir = r.dirs.indexOf('oracle') >= 0 ? 'Oracle' : 'MySQL';
      rows.push('<tr><td>' + Converter.escapeHtml(r.name) + '</td><td>' + dir + '</td><td>' +
        riskLabel(r.risk) + '</td><td>' + (r.kind === 'rewrite' ? '改写' : '仅提示') +
        '</td><td>' + Converter.escapeHtml(r.why) + '</td></tr>');
    });
    rows.push('</tbody></table>');
    els.rulesTable.innerHTML = rows.join('');
  }

  function openRules() {
    renderRuleTable();
    els.rulesModal.hidden = false;
  }

  function bind() {
    var dirBtns = document.querySelectorAll('.dir-btn');
    for (var i = 0; i < dirBtns.length; i++) {
      dirBtns[i].addEventListener('click', function () {
        state.dir = this.getAttribute('data-dir');
        syncDirButtons();
        if (els.input.value.trim()) run();
      });
    }

    els.input.addEventListener('input', function () {
      updateCharCount();
      clearTimeout(state.timer);
      state.timer = setTimeout(function () {
        if (els.input.value.trim()) run();
        else clearOutputs();
      }, 320);
    });
    els.input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    });

    els.run.addEventListener('click', run);
    els.clear.addEventListener('click', function () {
      els.input.value = '';
      updateCharCount();
      clearOutputs();
      setStatus('已清空');
      els.input.focus();
    });
    els.exportBtn.addEventListener('click', exportMarkdown);
    els.copyBtn.addEventListener('click', copyOutput);
    els.rulesBtn.addEventListener('click', openRules);
    els.modalClose.addEventListener('click', function () { els.rulesModal.hidden = true; });
    els.rulesModal.addEventListener('click', function (e) {
      if (e.target === els.rulesModal) els.rulesModal.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !els.rulesModal.hidden) els.rulesModal.hidden = true;
    });
    els.onlyHigh.addEventListener('change', function () {
      if (state.result) renderIssues(state.result);
    });
    els.klToggle.addEventListener('click', function () {
      els.klMore.hidden = !els.klMore.hidden;
      els.klToggle.textContent = els.klMore.hidden ? '详情' : '收起';
    });

    // 桌面端左右滚动同步
    var lock = false;
    function sync(src, dst) {
      src.addEventListener('scroll', function () {
        if (lock) return;
        lock = true;
        dst.scrollTop = src.scrollTop;
        dst.scrollLeft = src.scrollLeft;
        setTimeout(function () { lock = false; }, 30);
      });
    }
    sync(els.paneLeft, els.paneRight);
    sync(els.paneRight, els.paneLeft);
  }

  function init() {
    renderSamples();
    bind();
    els.ruleCountFooter.textContent = Converter.ruleCount();
    updateCharCount();
    // 支持 ?sample=my-ddl 直达某个样例，便于分享与截图
    var hit = (location.search || '').match(/[?&]sample=([\w-]+)/);
    if (hit) {
      for (var i = 0; i < SAMPLES.length; i++) {
        if (SAMPLES[i].id === hit[1]) {
          state.dir = SAMPLES[i].dir;
          syncDirButtons();
          els.input.value = SAMPLES[i].sql;
          updateCharCount();
          run();
          break;
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
