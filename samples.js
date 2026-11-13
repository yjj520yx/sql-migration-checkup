/* 6 个脱敏样例：覆盖建表、查询、写入三类场景与两个转换方向 */
var SAMPLES = [
  {
    id: 'ora-ddl',
    name: 'Oracle 建表与注释',
    dir: 'oracle',
    desc: 'VARCHAR2 BYTE/CHAR、NUMBER、裸 NUMBER、DATE、LONG、ROWID、COMMENT ON',
    sql: [
      'CREATE TABLE dm_emp (',
      '  emp_id      NUMBER(10)         NOT NULL,',
      '  emp_name    VARCHAR2(50 BYTE)  NOT NULL,',
      '  dept_name   VARCHAR2(80 CHAR),',
      '  salary      NUMBER(12,2),',
      '  bonus       NUMBER,',
      '  hire_date   DATE,',
      '  remark      LONG,',
      '  row_id      ROWID,',
      '  CONSTRAINT pk_dm_emp PRIMARY KEY (emp_id)',
      ');',
      '',
      "COMMENT ON TABLE dm_emp IS '员工主数据（脱敏样例）';",
      "COMMENT ON COLUMN dm_emp.emp_name IS '姓名';"
    ].join('\n')
  },
  {
    id: 'ora-query',
    name: 'Oracle 查询与分页',
    dir: 'oracle',
    desc: 'NVL、DECODE、TO_DATE 格式串、ROWNUM、MINUS',
    sql: [
      'SELECT e.emp_name,',
      '       NVL(e.salary, 0) AS salary,',
      "       DECODE(e.dept_name, '研发', 'R&D', '销售', 'SALES', 'OTHER') AS dept_code,",
      '       NVL2(e.bonus, e.bonus, 0) AS bonus,',
      "       NVL(TRIM(e.emp_name), '未知') AS emp_name2,",
      "       TO_DATE('2025-01-01 08:30:00', 'YYYY-MM-DD HH24:MI:SS') AS stat_time",
      '  FROM dm_emp e',
      " WHERE e.hire_date >= TO_DATE('2024-01-01', 'YYYY-MM-DD')",
      '   AND ROWNUM <= 20;',
      '',
      'SELECT emp_id FROM dm_emp',
      'MINUS',
      'SELECT emp_id FROM dm_emp_archive;'
    ].join('\n')
  },
  {
    id: 'ora-join',
    name: 'Oracle 多表与聚合',
    dir: 'oracle',
    desc: '(+) 外连接、WM_CONCAT、优化器提示、序列 NEXTVAL',
    sql: [
      'SELECT /*+ INDEX(e pk_dm_emp) */',
      '       e.dept_name,',
      '       WM_CONCAT(e.emp_name) AS names,',
      '       d.budget',
      '  FROM dm_emp e, dm_dept d',
      ' WHERE e.dept_id = d.dept_id(+)',
      ' GROUP BY e.dept_name, d.budget;',
      '',
      'INSERT INTO dm_emp (emp_id, emp_name)',
      "VALUES (dm_emp_seq.NEXTVAL, '张三');"
    ].join('\n')
  },
  {
    id: 'my-ddl',
    name: 'MySQL 建表',
    dir: 'mysql',
    desc: '反引号、自增、UNSIGNED、TINYINT(1)、ENUM、LONGTEXT、内联 KEY、列内 COMMENT、字符集',
    sql: [
      'CREATE TABLE `t_order` (',
      '  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,',
      "  `order_no` VARCHAR(32) NOT NULL COMMENT '订单号',",
      '  `status` TINYINT(1) NOT NULL DEFAULT 0,',
      '  `amount` DECIMAL(12,2) UNSIGNED NOT NULL,',
      "  `pay_type` ENUM('wechat','alipay','card') DEFAULT 'wechat',",
      '  `remark` LONGTEXT,',
      '  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      '  PRIMARY KEY (`id`),',
      '  KEY `idx_order_no` (`order_no`)',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;'
    ].join('\n')
  },
  {
    id: 'my-query',
    name: 'MySQL 查询与分页',
    dir: 'mysql',
    desc: 'IF()、DATE_FORMAT、CONCAT 多参数、NOW()、LIMIT m,n',
    sql: [
      'SELECT `order_no`,',
      "       IF(`status` = 1, '已支付', '未支付') AS status_text,",
      "       DATE_FORMAT(`created_at`, '%Y-%m-%d %H:%i:%s') AS created_text,",
      "       CONCAT(`order_no`, '-', `pay_type`) AS tag",
      '  FROM `t_order`',
      ' WHERE `created_at` >= NOW()',
      ' ORDER BY `id` DESC',
      ' LIMIT 100, 20;'
    ].join('\n')
  },
  {
    id: 'my-write',
    name: 'MySQL 批量写入',
    dir: 'mysql',
    desc: '# 注释、INSERT IGNORE、REPLACE INTO、ON DUPLICATE KEY、GROUP_CONCAT',
    sql: [
      '# 批量写入（脱敏样例）',
      'INSERT IGNORE INTO `t_order` (`order_no`, `amount`, `status`)',
      "VALUES ('A1001', 99.00, 0);",
      '',
      'REPLACE INTO `t_order` (`id`, `order_no`, `amount`)',
      "VALUES (1001, 'A1001', 99.00);",
      '',
      'INSERT INTO `t_order` (`id`, `order_no`, `amount`)',
      "VALUES (1002, 'A1002', 120.00)",
      'ON DUPLICATE KEY UPDATE `amount` = VALUES(`amount`);',
      '',
      'SELECT `status`, GROUP_CONCAT(`order_no` SEPARATOR \',\') AS nos',
      '  FROM `t_order`',
      ' GROUP BY `status`;'
    ].join('\n')
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SAMPLES;
}
