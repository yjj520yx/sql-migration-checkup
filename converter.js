/*
 * SQL 迁移体检台 · 转换引擎
 * 浏览器与 Node 均可加载（Node 仅用于本地自测）。
 */
(function (root) {
  var RULESET = (typeof module !== 'undefined' && module.exports)
    ? require('./rules.js').RULES
    : root.RULES;

  var RISK_WEIGHT = { high: 3, medium: 2, low: 1 };

  function normalize(sql) {
    return String(sql == null ? '' : sql).replace(/\r\n?/g, '\n');
  }

  function cloneRegex(re) {
    var flags = re.flags || (re.global ? 'g' : '') + (re.ignoreCase ? 'i' : '') + (re.multiline ? 'm' : '');
    return new RegExp(re.source, flags);
  }

  function lineNumberAt(text, index) {
    var line = 1;
    for (var i = 0; i < index && i < text.length; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    return line;
  }

  function pushIssue(issues, rule, text, index, before, after, extra) {
    var it = {
      ruleId: rule.id,
      name: rule.name,
      kind: rule.kind,
      risk: rule.risk,
      line: lineNumberAt(text, index),
      before: before,
      after: after,
      why: rule.why,
      note: rule.note,
      confirm: !!rule.confirm,
      offer: !!rule.offer
    };
    if (extra) for (var k in extra) it[k] = extra[k];
    issues.push(it);
  }

  function applyRewrite(rule, text, issues) {
    var re = cloneRegex(rule.regex);
    var out = '', last = 0, m, guard = 0;
    var agg = rule.aggregate ? { count: 0, first: null, line: 0 } : null;
    while ((m = re.exec(text)) !== null) {
      if (++guard > 5000) break;
      var built = rule.build ? rule.build(m, text) : m[0];
      if (built == null) {
        // 改写规则主动放弃时，若带 alt，则给出建议写法（不应用到输出）
        if (rule.alt) {
          var alt = null;
          try { alt = rule.alt(m, text); } catch (e2) { alt = null; }
          if (alt) {
            var altAfter = alt, altBefore = m[0];
            if (typeof alt === 'object') { altAfter = alt.after; altBefore = alt.before || m[0]; }
            pushIssue(issues, rule, text, m.index, altBefore, altAfter,
              { kind: 'advice', offer: true, why: rule.altWhy || rule.why, note: rule.altNote || rule.note, confirm: true });
          }
        }
        if (m[0].length === 0) re.lastIndex++;
        continue;
      }
      if (typeof built === 'string') built = { after: built, end: m.index + m[0].length };
      var end = (built.end == null) ? m.index + m[0].length : built.end;
      if (end <= last || end <= m.index) { if (m[0].length === 0) re.lastIndex++; continue; }
      var before = text.slice(m.index, end);
      if (built.after === before) { if (m[0].length === 0) re.lastIndex++; continue; }
      if (agg) {
        agg.count++;
        if (!agg.first) {
          agg.first = { before: before, after: built.after };
          agg.line = lineNumberAt(text, m.index);
        }
      } else {
        pushIssue(issues, rule, text, m.index, before, built.after);
      }
      out += text.slice(last, m.index) + built.after;
      last = end;
      re.lastIndex = end;
    }
    if (agg && agg.count > 0) {
      issues.push({
        ruleId: rule.id,
        name: rule.name,
        kind: rule.kind,
        risk: rule.risk,
        line: agg.line,
        before: agg.first.before,
        after: agg.first.after,
        count: agg.count,
        why: rule.why,
        note: rule.note,
        confirm: !!rule.confirm
      });
    }
    return out + text.slice(last);
  }

  function collectAdvice(rule, text, issues) {
    var re = cloneRegex(rule.regex);
    var m, count = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      var sug = rule.suggest;
      if (typeof sug === 'function') {
        try { sug = sug(m, text); } catch (e) { sug = null; }
      }
      var after = sug, before = m[0];
      if (sug && typeof sug === 'object') { after = sug.after; before = sug.before || m[0]; }
      pushIssue(issues, rule, text, m.index, before, after || '（保持原写法，需人工确认）',
        { offer: !!rule.offer && !!after });
      if (++count >= 30) break;
    }
    return text;
  }

  function convert(sql, dir) {
    var text = normalize(sql);
    if (text.length > 200000) {
      return { ok: false, error: 'SQL 超过 20 万字符，请拆分后再试。', output: text, issues: [], stats: { high: 0, medium: 0, low: 0, total: 0, offered: 0 }, elapsed: 0 };
    }
    var start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var issues = [];
    var failedRules = [];

    for (var i = 0; i < RULESET.length; i++) {
      var rule = RULESET[i];
      if (rule.dirs.indexOf(dir) < 0) continue;
      if (rule.kind !== 'rewrite' && rule.kind !== 'advice') continue;
      try {
        text = (rule.kind === 'rewrite')
          ? applyRewrite(rule, text, issues)
          : collectAdvice(rule, text, issues);
      } catch (e) {
        failedRules.push(rule.id);
      }
    }

    issues.sort(function (a, b) {
      return a.line - b.line || RISK_WEIGHT[b.risk] - RISK_WEIGHT[a.risk];
    });

    var stats = { high: 0, medium: 0, low: 0, total: issues.length, offered: 0 };
    for (var j = 0; j < issues.length; j++) {
      stats[issues[j].risk]++;
      if (issues[j].offer) stats.offered++;
    }

    var end = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    return {
      ok: true,
      output: text,
      issues: issues,
      stats: stats,
      elapsed: Math.max(1, Math.round(end - start)),
      failedRules: failedRules
    };
  }

  /* ---------- 行级 diff ---------- */

  function lcsOps(A, B) {
    var n = A.length, m = B.length;
    if (n * m > 1200000) return zipOps(A, B);
    var dp = new Array(n + 1);
    var i, j;
    for (i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = (A[i] === B[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: 'eq', a: i, b: j }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', a: i }); i++; }
      else { ops.push({ t: 'ins', b: j }); j++; }
    }
    while (i < n) { ops.push({ t: 'del', a: i }); i++; }
    while (j < m) { ops.push({ t: 'ins', b: j }); j++; }
    return ops;
  }

  function zipOps(A, B) {
    var ops = [], n = Math.max(A.length, B.length);
    for (var i = 0; i < n; i++) {
      if (i < A.length && i < B.length) ops.push(A[i] === B[i] ? { t: 'eq', a: i, b: i } : { t: 'del', a: i });
      else if (i < A.length) ops.push({ t: 'del', a: i });
      else ops.push({ t: 'ins', b: i });
    }
    return ops;
  }

  function diffRows(orig, out) {
    var A = orig.split('\n'), B = out.split('\n');
    var ops = lcsOps(A, B);
    var rows = [], i = 0;
    while (i < ops.length) {
      if (ops[i].t === 'eq') {
        rows.push({ type: 'eq', left: A[ops[i].a], right: B[ops[i].b] });
        i++;
        continue;
      }
      var dels = [], inss = [];
      while (i < ops.length && ops[i].t === 'del') { dels.push(ops[i].a); i++; }
      while (i < ops.length && ops[i].t === 'ins') { inss.push(ops[i].b); i++; }
      var k = Math.max(dels.length, inss.length);
      for (var x = 0; x < k; x++) {
        var l = x < dels.length ? A[dels[x]] : null;
        var r = x < inss.length ? B[inss[x]] : null;
        if (l !== null && r !== null) rows.push({ type: 'mod', left: l, right: r });
        else if (l !== null) rows.push({ type: 'del', left: l, right: null });
        else rows.push({ type: 'ins', left: null, right: r });
      }
    }
    return rows;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tokenize(s) {
    return s.split(/(\s+|[(),;=<>+\-*/|.'])/).filter(function (t) { return t !== ''; });
  }

  function wordDiff(a, b) {
    var ta = tokenize(a), tb = tokenize(b);
    if (ta.length * tb.length > 40000) {
      return ['<mark>' + escapeHtml(a) + '</mark>', '<mark class="add">' + escapeHtml(b) + '</mark>'];
    }
    var n = ta.length, m = tb.length;
    var dp = new Array(n + 1);
    var i, j;
    for (i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        dp[i][j] = ta[i] === tb[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var hA = '', hB = '';
    i = 0; j = 0;
    while (i < n && j < m) {
      if (ta[i] === tb[j]) { hA += escapeHtml(ta[i]); hB += escapeHtml(tb[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { hA += '<mark>' + escapeHtml(ta[i]) + '</mark>'; i++; }
      else { hB += '<mark class="add">' + escapeHtml(tb[j]) + '</mark>'; j++; }
    }
    while (i < n) { hA += '<mark>' + escapeHtml(ta[i]) + '</mark>'; i++; }
    while (j < m) { hB += '<mark class="add">' + escapeHtml(tb[j]) + '</mark>'; j++; }
    return [hA, hB];
  }

  /* ---------- Markdown 报告 ---------- */

  function mdCell(s) {
    return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function buildReport(input, result, dirLabel, when) {
    var d = when || new Date();
    var stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    var s = result.stats;
    var lines = [];
    lines.push('# SQL 迁移体检报告');
    lines.push('');
    lines.push('- 生成时间：' + stamp);
    lines.push('- 转换方向：' + dirLabel);
    lines.push('- 原始字符数：' + input.length);
    lines.push('- 改写后字符数：' + result.output.length);
    lines.push('- 问题统计：高危 ' + s.high + ' · 中危 ' + s.medium + ' · 低危 ' + s.low + ' · 合计 ' + s.total);
    if (s.offered) {
      lines.push('- 给出建议写法：' + s.offered + ' 处（未自动应用，需人工确认后替换）');
    }
    lines.push('');
    lines.push('## 一、原始 SQL');
    lines.push('');
    lines.push('```sql');
    lines.push(input);
    lines.push('```');
    lines.push('');
    lines.push('## 二、改写后的 SQL');
    lines.push('');
    lines.push('```sql');
    lines.push(result.output);
    lines.push('```');
    lines.push('');
    lines.push('## 三、问题清单');
    lines.push('');
    if (result.issues.length === 0) {
      lines.push('未发现需要处理的问题。仍建议在目标库实测一次。');
    } else {
      lines.push('| # | 等级 | 规则 | 行 | 原文 / 建议 | 改后 / 建议 | 为什么 | 需人工确认 |');
      lines.push('|---|---|---|---|---|---|---|');
      for (var i = 0; i < result.issues.length; i++) {
        var it = result.issues[i];
        var lv = it.risk === 'high' ? '高' : it.risk === 'medium' ? '中' : '低';
        lines.push('| ' + (i + 1) + ' | ' + lv + ' | ' + mdCell(it.name) +
          (it.count > 1 ? '（共 ' + it.count + ' 处）' : '') + ' | ' + it.line + ' | ' +
          '`' + mdCell(it.before) + '` | `' + mdCell(it.after) + '` | ' + mdCell(it.why) +
          (it.note ? '<br>风险说明：' + mdCell(it.note) : '') + ' | ' + (it.confirm ? '是' : '否') + ' |');
      }
    }
    var offered = result.issues.filter(function (x) { return x.offer; });
    if (offered.length) {
      lines.push('');
      lines.push('## 四、建议改写（未自动应用，需人工确认）');
      lines.push('');
      lines.push('以下写法工具**没有**自动替换到「改写后的 SQL」里：语义能否等价取决于数据与业务规则，需要人工确认后再手工替换。');
      lines.push('');
      for (var k = 0; k < offered.length; k++) {
        var o = offered[k];
        lines.push('### ' + (k + 1) + '. ' + o.name + '（第 ' + o.line + ' 行，' + (o.risk === 'high' ? '高危' : o.risk === 'medium' ? '中危' : '低危') + '）');
        lines.push('');
        lines.push('**原写法**');
        lines.push('');
        lines.push('```sql');
        lines.push(o.before);
        lines.push('```');
        lines.push('');
        lines.push('**建议写法**');
        lines.push('');
        lines.push('```sql');
        lines.push(o.after);
        lines.push('```');
        lines.push('');
        lines.push('**为什么这样建议**：' + o.why);
        lines.push('');
        lines.push('**为什么必须人工确认**：' + (o.note || '工具的改写不保证语义等价。'));
        lines.push('');
      }
    }
    lines.push('');
    lines.push('## ' + (offered.length ? '五' : '四') + '、已知限制');
    lines.push('');
    lines.push('- 本工具不连接数据库、不执行 SQL，结果不能替代目标达梦库上的实测。');
    lines.push('- 不保证语义完全等价，尤其是日期精度、字符长度、NULL 处理、分页顺序。');
    lines.push('- 存储过程、触发器、动态 SQL 只做识别提示，不做改写。');
    lines.push('- 规则按高频场景挑选，覆盖有限，复杂写法请人工复核。');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('由「SQL 迁移体检台」生成（纯前端，SQL 未上传）。');
    return lines.join('\n');
  }

  var Converter = {
    convert: convert,
    diffRows: diffRows,
    wordDiff: wordDiff,
    escapeHtml: escapeHtml,
    buildReport: buildReport,
    ruleCount: function (dir) {
      var c = 0;
      for (var i = 0; i < RULESET.length; i++) {
        if (!dir || RULESET[i].dirs.indexOf(dir) >= 0) c++;
      }
      return c;
    },
    rules: RULESET,
    version: 'v1.1'
  };

  root.Converter = Converter;
  if (typeof module !== 'undefined' && module.exports) module.exports = Converter;
})(typeof window !== 'undefined' ? window : globalThis);
