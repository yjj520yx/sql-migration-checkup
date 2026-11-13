/*
 * SQL 迁移体检台 · 规则表
 * 规则是数据，不是散落的正则：
 *   id      唯一标识
 *   name    规则名（界面展示）
 *   dirs    适用方向：'oracle' | 'mysql'
 *   kind    'rewrite' 安全改写 | 'advice' 只提示不改写
 *   risk    'high' | 'medium' | 'low'
 *   regex   匹配表达式（g 标记）
 *   build   改写规则：返回字符串，或 {after, end}；返回 null 表示放弃改写
 *   suggest 提示规则：给出建议写法
 *   why     为什么改 / 为什么提示
 *   note    风险说明
 *   confirm 是否需要人工确认
 */
var SqlUtil = (function () {
  // 从 openIndex 处的 '(' 开始读取一次函数调用，返回 {args:[], end: 右括号后一位}
  function readCall(sql, openIndex) {
    var depth = 0, i = openIndex, args = [], cur = '', inStr = false, quote = '';
    if (sql[openIndex] !== '(') return null;
    for (; i < sql.length; i++) {
      var ch = sql[i];
      if (inStr) {
        cur += ch;
        if (ch === quote) {
          if (sql[i + 1] === quote) { cur += sql[i + 1]; i++; }
          else inStr = false;
        }
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { inStr = true; quote = ch; cur += ch; continue; }
      if (ch === '(') {
        depth++;
        if (depth === 1) continue;
        cur += ch;
        continue;
      }
      if (ch === ')') {
        depth--;
        if (depth === 0) { args.push(cur.trim()); return { args: args, end: i + 1 }; }
        cur += ch;
        continue;
      }
      if (ch === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    return null;
  }

  function hasSubquery(args) {
    for (var i = 0; i < args.length; i++) {
      if (/\b(select|union|from)\b/i.test(args[i])) return true;
    }
    return false;
  }

  return { readCall: readCall, hasSubquery: hasSubquery };
})();

var RULES = [
  /* ============ Oracle → 达梦 ============ */
  {
    id: 'ORA-VARCHAR2-BYTE',
    name: 'VARCHAR2(n BYTE) → VARCHAR(n)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bVARCHAR2\s*\(\s*(\d+)\s+BYTE\s*\)/gi,
    build: function (m) { return 'VARCHAR(' + m[1] + ')'; },
    why: '达梦支持 VARCHAR2，但 BYTE 是按字节计长的 Oracle 语义；统一改为 VARCHAR 并在达梦中按字符计长。',
    note: '中文场景下同样的 n，按字节算与按字符算可容纳的字数差很多（UTF-8 下一个汉字通常 3 字节），长度上限必须人工确认。',
    confirm: true
  },
  {
    id: 'ORA-VARCHAR2-CHAR',
    name: 'VARCHAR2(n CHAR) → VARCHAR(n)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bVARCHAR2\s*\(\s*(\d+)\s+CHAR\s*\)/gi,
    build: function (m) { return 'VARCHAR(' + m[1] + ')'; },
    why: 'CHAR 语义本身就是按字符计长，与达梦 VARCHAR 的默认计长方式一致，可直接去掉声明。',
    note: '若目标库初始化参数 LENGTH_IN_CHAR 与外层系统约定不同，仍需回归一次长度校验。',
    confirm: false
  },
  {
    id: 'ORA-VARCHAR2',
    name: 'VARCHAR2(n) → VARCHAR(n)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bVARCHAR2\s*\(\s*(\d+)\s*\)/gi,
    build: function (m) { return 'VARCHAR(' + m[1] + ')'; },
    why: '达梦兼容 VARCHAR2，但 VARCHAR 是标准写法，迁移到其他库时也通用。',
    note: '长度不变，语义一致。',
    confirm: false
  },
  {
    id: 'ORA-NVARCHAR2',
    name: 'NVARCHAR2(n) → NVARCHAR(n)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bNVARCHAR2\s*\(\s*(\d+)\s*\)/gi,
    build: function (m) { return 'NVARCHAR(' + m[1] + ')'; },
    why: '达梦使用 NVARCHAR 表示国家字符集字符串，去掉 Oracle 的 "2" 后缀即可。',
    note: '需确认达梦实例的国家字符集与 Oracle 库一致，否则排序与比较结果可能不同。',
    confirm: false
  },
  {
    id: 'ORA-NUMBER-PS',
    name: 'NUMBER(p,s) → DECIMAL(p,s)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bNUMBER\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
    build: function (m) { return 'DECIMAL(' + m[1] + ',' + m[2] + ')'; },
    why: '达梦可直接使用 DECIMAL 表达定点数，精度与小数位和 NUMBER(p,s) 一一对应。',
    note: '保留 NUMBER 写法也能运行，这里统一为 DECIMAL 便于跨库阅读。',
    confirm: false
  },
  {
    id: 'ORA-NUMBER-P',
    name: 'NUMBER(p) → DECIMAL(p)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bNUMBER\s*\(\s*(\d+)\s*\)/gi,
    build: function (m) { return 'DECIMAL(' + m[1] + ')'; },
    why: 'NUMBER(p) 等价于小数位为 0 的定点数，DECIMAL(p) 语义一致。',
    note: '若业务会写入小数，原 NUMBER(p) 本来也会截断，行为不变。',
    confirm: false
  },
  {
    id: 'ORA-NUMBER-BARE',
    name: '未声明精度的 NUMBER',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'high',
    regex: /\bNUMBER\b(?!\s*\()/gi,
    suggest: 'NUMBER → DECIMAL(38,10)（按业务确认）',
    why: 'Oracle 的裸 NUMBER 可以存任意精度数值；达梦在未显式声明时按自身默认精度处理，跨库写入大数或高精度小数可能溢出或被四舍五入。',
    note: '必须按真实数据范围显式声明精度，无法从 SQL 文本推断。',
    confirm: true
  },
  {
    id: 'ORA-NVL',
    name: 'NVL(a,b) → IFNULL(a,b)',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bNVL\s*\(\s*([^(),;]{1,80}?)\s*,\s*([^(),;]{1,80}?)\s*\)/gi,
    build: function (m) { return 'IFNULL(' + m[1] + ', ' + m[2] + ')'; },
    why: '达梦同时支持 NVL 与 IFNULL，统一为 IFNULL 便于跨库阅读。',
    note: '仅改写两个参数都是简单表达式的 NVL；参数里含函数嵌套时保持原样，避免括号匹配出错。',
    confirm: false
  },
  {
    id: 'ORA-DECODE',
    name: 'DECODE(...) → CASE WHEN',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bDECODE\s*\(/gi,
    build: function (m, sql) {
      var open = sql.indexOf('(', m.index);
      if (open < 0) return null;
      var call = SqlUtil.readCall(sql, open);
      if (!call) return null;
      var args = call.args;
      if (args.length < 3 || SqlUtil.hasSubquery(args)) return null;
      var whens = [], i;
      for (i = 1; i + 1 < args.length; i += 2) {
        whens.push('WHEN ' + args[i] + ' THEN ' + args[i + 1]);
      }
      var def = ((args.length - 1) % 2 === 1) ? args[args.length - 1] : null;
      var after = 'CASE ' + args[0] + ' ' + whens.join(' ') + (def !== null ? ' ELSE ' + def : '') + ' END';
      return { after: after, end: call.end };
    },
    why: '达梦支持 DECODE，但 CASE WHEN 是标准 SQL，行为等价且更易读。',
    note: 'DECODE 把两个 NULL 视为相等，CASE 的 NULL 比较会得到 UNKNOWN。若参与比较的列可能为 NULL，结果会不同，必须人工确认。',
    confirm: true
  },
  {
    id: 'ORA-TO-DATE',
    name: 'TO_DATE 格式串兼容性',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /\bTO_DATE\s*\(/gi,
    suggest: '保留 TO_DATE，在目标库实测格式串；含毫秒时改用 TO_TIMESTAMP',
    why: '达梦支持 Oracle 风格格式串（YYYY-MM-DD HH24:MI:SS 等），但不同版本对 HH24、毫秒、NLS 相关格式的支持不完全一致。',
    note: '日期格式错会在运行期报错或静默截断，属于必须实测的一类。',
    confirm: true
  },
  {
    id: 'ORA-ROWNUM',
    name: 'ROWNUM 分页写法',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /\bROWNUM\b/gi,
    suggest: 'WHERE ROWNUM <= 20 → LIMIT 20；区间分页 → LIMIT n OFFSET m（需结合 ORDER BY 重写）',
    why: '达梦兼容 ROWNUM，原写法通常可以直接运行；但标准分页写法更清晰，也不依赖 Oracle 兼容模式。',
    note: 'ROWNUM 与 ORDER BY 的执行顺序在嵌套子查询里容易出错，改写分页时必须连同排序一起确认。',
    confirm: true
  },
  {
    id: 'ORA-PLUS-JOIN',
    name: 'Oracle (+) 外连接',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'high',
    regex: /\(\s*\+\s*\)/g,
    suggest: 'FROM a, b WHERE a.id = b.a_id(+) → FROM a LEFT JOIN b ON a.id = b.a_id',
    why: '达梦只兼容部分 (+) 写法，多表混合、带 OR 条件时行为容易出错。改为 ANSI JOIN 后语义明确。',
    note: '无法从片段判断应该 LEFT 还是 RIGHT，也无法判断连接条件边界，必须人工改写并核对结果行数。',
    confirm: true
  },
  {
    id: 'ORA-COMMENT-ON',
    name: 'COMMENT ON 语句',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'low',
    regex: /\bCOMMENT\s+ON\s+(?:TABLE|COLUMN)\b/gi,
    suggest: '无需改写，达梦支持 COMMENT ON TABLE / COLUMN',
    why: '达梦原生支持 COMMENT ON 语法，迁移时可以原样保留。',
    note: '确认执行账号有 COMMENT ANY TABLE 权限。',
    confirm: false
  },
  {
    id: 'ORA-ROWID',
    name: 'ROWID 作为标识',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'high',
    regex: /\bROWID\b/gi,
    suggest: '不要用 ROWID 做主键或持久化标识，改用业务主键',
    why: '达梦虽然有 ROWID，但它的取值规则与 Oracle 不同，且会随数据重组变化，不能作为稳定标识。',
    note: '把 ROWID 存进业务表是典型的迁移事故点，必须改表结构。',
    confirm: true
  },
  {
    id: 'ORA-LONG',
    name: 'LONG / LONG RAW',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'high',
    regex: /\bLONG(?:\s+RAW)?\b/gi,
    suggest: 'LONG → CLOB；LONG RAW → BLOB',
    why: 'LONG 是 Oracle 的历史类型，达梦不支持，必须改成大对象类型。',
    note: '改类型会牵动写入方式（JDBC 流式写入）与查询方式，需要一并改应用代码。',
    confirm: true
  },
  {
    id: 'ORA-DATE-TYPE',
    name: 'DATE 的时分秒语义',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /\bDATE\b/gi,
    suggest: '需要时分秒时显式用 TIMESTAMP；仅日期用 DATE',
    why: 'Oracle 的 DATE 同时包含日期与时分秒；达梦 DATE 的精度语义随版本与兼容参数变化，跨库时容易出现时间部分丢失。',
    note: '这是"看起来都对、对账时差几秒"的典型问题，必须按版本确认。',
    confirm: true
  },
  {
    id: 'ORA-EMPTY-STRING',
    name: "空字符串 '' 与 NULL",
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /''/g,
    suggest: "确认目标库对 '' 的处理；需要严格等价时改用 NULL 并调整判断条件",
    why: 'Oracle 把空字符串当作 NULL；达梦在部分兼容模式下按空串处理，导致 IS NULL 判断结果不同。',
    note: '影响去重、唯一索引与非空校验，属于数据一致性问题。',
    confirm: true
  },
  {
    id: 'ORA-HINT',
    name: '优化器提示 /*+ ... */',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /\/\*\+[\s\S]*?\*\//g,
    suggest: '移除提示，按达梦执行计划重新评估，必要时用达梦的 HINT 语法',
    why: 'Oracle 的优化器提示在达梦上通常不生效，留着会让人误以为已经调优。',
    note: '性能问题应在目标库用真实数据量重新测，不要照搬 Oracle 的执行计划假设。',
    confirm: true
  },
  {
    id: 'ORA-MINUS',
    name: 'MINUS → EXCEPT',
    dirs: ['oracle'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bMINUS\b/gi,
    build: function () { return 'EXCEPT'; },
    why: 'MINUS 与 EXCEPT 都是"取差集并去重"，达梦支持 EXCEPT 标准写法。',
    note: '两者都去重；若业务需要保留重复行，应改用 NOT EXISTS。',
    confirm: false
  },
  {
    id: 'ORA-WM-CONCAT',
    name: 'WM_CONCAT 聚合拼接',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /\bWM_CONCAT\s*\(/gi,
    suggest: "WM_CONCAT(x) → LISTAGG(x, ',') WITHIN GROUP (ORDER BY 排序列)",
    why: '达梦没有 WM_CONCAT，聚合字符串要用 LISTAGG，且必须指定排序。',
    note: '排序不同会导致拼接结果顺序不同，影响下游解析，必须人工确认排序键。',
    confirm: true
  },
  {
    id: 'ORA-SEQUENCE',
    name: '序列 NEXTVAL / CURRVAL',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'medium',
    regex: /\b[A-Za-z0-9_$#]+\s*\.\s*(?:NEXTVAL|CURRVAL)\b/gi,
    suggest: '单独迁移序列定义，核对 START WITH / INCREMENT BY / CACHE',
    why: '达梦支持序列，但序列对象不会随表结构一起迁移；漏迁会导致主键冲突或直接报错。',
    note: '切换前要预留号段，避免新旧库并行写入时主键重叠。',
    confirm: true
  },
  {
    id: 'ORA-NLS-SESSION',
    name: 'ALTER SESSION SET NLS_*',
    dirs: ['oracle'],
    kind: 'advice',
    risk: 'high',
    regex: /\bNLS_[A-Z_]+\b/gi,
    suggest: '移除 NLS 会话设置，改为在连接参数/库级参数中配置日期与排序规则',
    why: 'NLS_* 是 Oracle 的会话级国际化参数，达梦多数不支持，执行会报错或被忽略。',
    note: '依赖 NLS_DATE_FORMAT 隐式转换的代码，必须在迁移时改成显式 TO_DATE。',
    confirm: true
  },

  /* ============ MySQL → 达梦 ============ */
  {
    id: 'MY-RESERVED',
    name: '反引号包裹的保留字',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'medium',
    regex: /`(status|level|comment|key|desc|type|size|order|group|check|rank|range|condition|system|value|values)`/gi,
    suggest: '保留字建议改名（如 status → order_status），或加双引号并确认大小写设置',
    why: '这些词在达梦中可能是保留字；去掉反引号后可能直接报语法错误。',
    note: '用双引号包裹会让标识符变成大小写敏感，与未加引号的既有对象不匹配，需统一约定。',
    confirm: true
  },
  {
    id: 'MY-BACKTICK',
    name: '反引号标识符 → 裸标识符',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    aggregate: true,
    regex: /`([^`\n]{1,64})`/g,
    build: function (m) { return m[1]; },
    why: '反引号是 MySQL 专有引用方式，达梦不识别；去掉后按达梦的标识符规则解析。',
    note: '达梦默认大小写不敏感（取决于初始化参数）。若原库用引号制造了大小写敏感的名字，或标识符本身是保留字，仍需人工确认。',
    confirm: false
  },
  {
    id: 'MY-AUTO-INCREMENT',
    name: 'AUTO_INCREMENT → IDENTITY(1,1)',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bAUTO_INCREMENT\b/gi,
    build: function () { return 'IDENTITY(1,1)'; },
    why: '达梦用 IDENTITY(1,1) 表示自增列，起始值 1、步长 1。',
    note: '建议把 IDENTITY(1,1) 紧跟在列类型之后；一张表只能有一个自增列，原表若有复合自增定义需人工处理。',
    confirm: true
  },
  {
    id: 'MY-ENGINE',
    name: 'ENGINE=... 存储引擎',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\s+ENGINE\s*=\s*[A-Za-z0-9_]+/gi,
    build: function () { return ''; },
    why: '存储引擎是 MySQL 的概念，达梦没有这个选项，直接移除。',
    note: 'InnoDB 的事务与行锁特性在达梦中默认具备，无需声明。',
    confirm: false
  },
  {
    id: 'MY-CHARSET',
    name: 'CHARACTER SET / CHARSET',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\s*(?:DEFAULT\s+)?(?:CHARSET|CHARACTER\s+SET)\s*(?:=\s*)?[A-Za-z0-9_]+/gi,
    build: function () { return ''; },
    why: 'MySQL 允许在表/列级声明字符集；达梦的字符集在实例级配置，DDL 里的声明无效。',
    note: '迁移前要确认目标实例字符集（UTF-8）与应用一致，否则中文会乱码。',
    confirm: false
  },
  {
    id: 'MY-COLLATE',
    name: 'COLLATE 排序规则',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\s+COLLATE\s*=?\s*[A-Za-z0-9_]+/gi,
    build: function () { return ''; },
    why: '排序规则在达梦中由库/列级参数控制，DDL 内的 COLLATE 不适用。',
    note: 'MySQL 的 utf8mb4_general_ci 与达梦默认排序在大小写、重音上的行为可能不同。',
    confirm: false
  },
  {
    id: 'MY-UNSIGNED',
    name: 'UNSIGNED 无符号类型',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\s+UNSIGNED\b/gi,
    build: function () { return ''; },
    why: '达梦没有无符号类型，去掉声明后列可以存负数。',
    note: '若业务依赖"不能为负"，需补 CHECK (列 >= 0)，否则会放松数据约束。',
    confirm: true
  },
  {
    id: 'MY-ZEROFILL',
    name: 'ZEROFILL 补零显示',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\s+ZEROFILL\b/gi,
    build: function () { return ''; },
    why: 'ZEROFILL 只是显示属性，不影响存储；达梦没有对应声明。',
    note: '需要补零展示时，在查询层用 LPAD(CAST(列 AS VARCHAR), n, \'0\')。',
    confirm: false
  },
  {
    id: 'MY-TINYINT1',
    name: 'TINYINT(1) → TINYINT',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bTINYINT\s*\(\s*1\s*\)/gi,
    build: function () { return 'TINYINT'; },
    why: 'MySQL 常用 TINYINT(1) 表示布尔；达梦的 TINYINT 只是小整数，且不接受显示宽度写法。',
    note: '去掉 (1) 后仍然是 0/1 整数列；如果 ORM 按 boolean 映射，需要回归一次读写。',
    confirm: true
  },
  {
    id: 'MY-ENUM-SET',
    name: 'ENUM / SET 类型',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'high',
    regex: /\b(?:ENUM|SET)\s*\(/gi,
    suggest: "ENUM('a','b') → VARCHAR(20) + CHECK (col IN ('a','b'))",
    why: '达梦不支持 ENUM/SET，必须改为字符串 + 约束，否则建表直接失败。',
    note: '原 ENUM 的隐式序号（存 1/2/3）如果被应用依赖，要一并改数据。',
    confirm: true
  },
  {
    id: 'MY-TEXT-BLOB',
    name: 'TEXT / BLOB 家族类型',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\b(?:TINYTEXT|MEDIUMTEXT|LONGTEXT|TEXT|TINYBLOB|MEDIUMBLOB|LONGBLOB)\b/gi,
    build: function (m) {
      return /BLOB/i.test(m[0]) ? 'BLOB' : 'CLOB';
    },
    why: '达梦用 CLOB/BLOB 表示大文本与大二进制，TEXT 家族统一收敛。',
    note: 'TINYTEXT 等有长度上限，改成 CLOB 后上限放大，属于放宽约束。',
    confirm: false
  },
  {
    id: 'MY-LIMIT-OFFSET',
    name: 'LIMIT m,n → LIMIT n OFFSET m',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi,
    build: function (m) { return 'LIMIT ' + m[2] + ' OFFSET ' + m[1]; },
    why: 'MySQL 的 LIMIT offset,count 与达梦的 LIMIT count OFFSET offset 参数顺序相反，直接照搬会取错数据。',
    note: '语义等价，但深分页性能都差，建议配合主键游标。',
    confirm: false
  },
  {
    id: 'MY-NOW',
    name: 'NOW() → SYSDATE',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bNOW\s*\(\s*\)/gi,
    build: function () { return 'SYSDATE'; },
    why: '达梦用 SYSDATE / CURRENT_TIMESTAMP 获取当前时间，NOW() 不是必备函数。',
    note: '两者都返回秒级时间；需要毫秒时用 SYSTIMESTAMP。',
    confirm: false
  },
  {
    id: 'MY-IF-FUNC',
    name: 'IF(cond,a,b) → CASE WHEN',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /\bIF\s*\(/gi,
    build: function (m, sql) {
      var open = sql.indexOf('(', m.index);
      if (open < 0) return null;
      var call = SqlUtil.readCall(sql, open);
      if (!call || call.args.length !== 3) return null;
      if (SqlUtil.hasSubquery(call.args)) return null;
      return {
        after: 'CASE WHEN ' + call.args[0] + ' THEN ' + call.args[1] + ' ELSE ' + call.args[2] + ' END',
        end: call.end
      };
    },
    why: '达梦没有 MySQL 的三元 IF() 函数，CASE WHEN 是等价的标准写法。',
    note: '仅改写参数为简单表达式的 IF()，嵌套子查询时保持原样并人工处理。',
    confirm: false
  },
  {
    id: 'MY-DATE-FORMAT',
    name: 'DATE_FORMAT → TO_CHAR',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bDATE_FORMAT\s*\(/gi,
    build: function (m, sql) {
      var open = sql.indexOf('(', m.index);
      if (open < 0) return null;
      var call = SqlUtil.readCall(sql, open);
      if (!call || call.args.length !== 2) return null;
      var fmtArg = call.args[1];
      var q = fmtArg.match(/^'([\s\S]*)'$/);
      if (!q) return null;
      var mapped = mapDateFormat(q[1]);
      if (mapped === null) return null;
      return { after: 'TO_CHAR(' + call.args[0] + ", '" + mapped + "')", end: call.end };
    },
    why: '达梦没有 DATE_FORMAT，日期格式化用 TO_CHAR + Oracle 风格格式串。',
    note: '只改写能完整映射的格式串；含 %U、%W、%j 等未覆盖占位符时保持原样，需人工处理。',
    confirm: true
  },
  {
    id: 'MY-STR-TO-DATE',
    name: 'STR_TO_DATE → TO_DATE',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bSTR_TO_DATE\s*\(/gi,
    build: function (m, sql) {
      var open = sql.indexOf('(', m.index);
      if (open < 0) return null;
      var call = SqlUtil.readCall(sql, open);
      if (!call || call.args.length !== 2) return null;
      var q = call.args[1].match(/^'([\s\S]*)'$/);
      if (!q) return null;
      var mapped = mapDateFormat(q[1]);
      if (mapped === null) return null;
      return { after: 'TO_DATE(' + call.args[0] + ", '" + mapped + "')", end: call.end };
    },
    why: '达梦用 TO_DATE 做字符串转日期，格式串需要从 MySQL 的 % 占位符映射为 Oracle 风格。',
    note: '格式串映射不完整时会直接放弃改写（宁可不改），需人工确认。',
    confirm: true
  },
  {
    id: 'MY-CONCAT-MULTI',
    name: 'CONCAT 多参数 → || 拼接',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\bCONCAT\s*\(/gi,
    build: function (m, sql) {
      var open = sql.indexOf('(', m.index);
      if (open < 0) return null;
      var call = SqlUtil.readCall(sql, open);
      if (!call || call.args.length <= 2) return null;
      if (SqlUtil.hasSubquery(call.args)) return null;
      return { after: '(' + call.args.join(' || ') + ')', end: call.end };
    },
    why: '达梦的 CONCAT 只接受 2 个参数，多参数需改成 || 拼接。',
    note: 'MySQL 的 CONCAT 遇到 NULL 返回 NULL，达梦的 || 默认同样传播 NULL；若原逻辑依赖这一行为，改完需验证一次。',
    confirm: true
  },
  {
    id: 'MY-GROUP-CONCAT',
    name: 'GROUP_CONCAT 聚合拼接',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'high',
    regex: /\bGROUP_CONCAT\s*\(/gi,
    suggest: "GROUP_CONCAT(x SEPARATOR ',') → LISTAGG(x, ',') WITHIN GROUP (ORDER BY 排序列)",
    why: '达梦没有 GROUP_CONCAT，必须改 LISTAGG，而且 LISTAGG 要求显式排序。',
    note: 'SEPARATOR、DISTINCT、ORDER BY 三个子句都要逐项映射，长度超限行为也不同。',
    confirm: true
  },
  {
    id: 'MY-ON-DUPLICATE',
    name: 'ON DUPLICATE KEY UPDATE',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'high',
    regex: /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/gi,
    suggest: '改 MERGE INTO t USING (VALUES ...) ON (唯一键) WHEN MATCHED THEN UPDATE ...',
    why: '这是 MySQL 专有语法，达梦不支持，不能靠替换关键字解决。',
    note: 'MERGE 的并发行为与原语法不同（可能死锁或覆盖），必须在事务里压测。',
    confirm: true
  },
  {
    id: 'MY-INSERT-IGNORE',
    name: 'INSERT IGNORE',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'high',
    regex: /\bINSERT\s+IGNORE\b/gi,
    suggest: '改 MERGE INTO ... WHEN NOT MATCHED THEN INSERT，或捕获唯一键异常',
    why: '达梦没有 INSERT IGNORE，"忽略冲突"的语义要靠 MERGE 或应用层异常处理实现。',
    note: '原语法会忽略所有可忽略错误（不只唯一键），迁移后错误范围会变窄。',
    confirm: true
  },
  {
    id: 'MY-REPLACE-INTO',
    name: 'REPLACE INTO',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'high',
    regex: /\bREPLACE\s+INTO\b/gi,
    suggest: '改 DELETE + INSERT（同事务）或 MERGE INTO',
    why: '达梦没有 REPLACE INTO，它隐含"先删后插"，会触发级联删除与自增消耗。',
    note: '改写时必须确认外键级联与触发器影响。',
    confirm: true
  },
  {
    id: 'MY-INLINE-KEY',
    name: '建表内联 KEY / INDEX',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'high',
    regex: /,\s*(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?[A-Za-z0-9_]+`?\s*\([^)]*\)/gi,
    build: function () { return ''; },
    why: '达梦的 CREATE TABLE 不支持 MySQL 那种内联 KEY 定义，保留会导致建表失败；这里先移除，让 DDL 能跑通。',
    note: '被移除的索引必须补成独立的 CREATE INDEX 语句（含 UNIQUE），否则性能和唯一约束都会丢。',
    confirm: true
  },
  {
    id: 'MY-INLINE-COMMENT',
    name: '列内 COMMENT → COMMENT ON',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'medium',
    regex: /\s+COMMENT\s+'(?:[^']|'')*'/gi,
    build: function () { return ''; },
    why: 'MySQL 允许在列定义后直接写 COMMENT，达梦要用独立的 COMMENT ON COLUMN 语句。',
    note: '这里只移除内联注释，注释内容需要人工搬到 COMMENT ON COLUMN，否则会丢注释。',
    confirm: true
  },
  {
    id: 'MY-HASH-COMMENT',
    name: '# 注释 → -- 注释',
    dirs: ['mysql'],
    kind: 'rewrite',
    risk: 'low',
    regex: /(^|\n)([ \t]*)#[ \t]?/g,
    build: function (m) { return m[1] + m[2] + '-- '; },
    why: 'MySQL 支持 # 行注释，达梦只认 -- 与 /* */。',
    note: '注释内容不变，仅换标记。',
    confirm: false
  },
  {
    id: 'MY-REGEXP',
    name: 'REGEXP 运算符',
    dirs: ['mysql'],
    kind: 'advice',
    risk: 'medium',
    regex: /\bREGEXP\b/gi,
    suggest: 'col REGEXP \'pat\' → REGEXP_LIKE(col, \'pat\')',
    why: '达梦用 REGEXP_LIKE 函数做正则匹配，MySQL 的 REGEXP 中缀运算符不适用。',
    note: '两边的正则方言不完全一致（转义、大小写敏感参数），需按样例回归。',
    confirm: true
  }
];

// MySQL 日期格式占位符 → Oracle 格式串；遇到未知占位符返回 null（放弃改写）
function mapDateFormat(fmt) {
  var map = {
    '%Y': 'YYYY', '%y': 'YY', '%m': 'MM', '%d': 'DD', '%e': 'DD',
    '%H': 'HH24', '%k': 'HH24', '%h': 'HH12', '%l': 'HH12',
    '%i': 'MI', '%s': 'SS', '%S': 'SS',
    '%M': 'MONTH', '%b': 'MON', '%W': 'DAY', '%a': 'DY',
    '%p': 'AM', '%T': 'HH24:MI:SS', '%r': 'HH12:MI:SS AM'
  };
  var out = fmt.replace(/%%|%[A-Za-z]/g, function (t) {
    if (t === '%%') return '%';
    return map[t] || '__UNKNOWN__';
  });
  if (out.indexOf('__UNKNOWN__') >= 0) return null;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RULES: RULES, SqlUtil: SqlUtil, mapDateFormat: mapDateFormat };
}
