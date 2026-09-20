-- 001_init：只建立迁移记账表本身，证明运行器机制可用；业务表留给后续批次（#27/#28）。
-- 决策：不提供 downgrade。已应用的迁移文件不得再修改，回滚靠从备份恢复。
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
