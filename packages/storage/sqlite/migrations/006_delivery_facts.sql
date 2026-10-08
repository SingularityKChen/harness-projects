-- 006_delivery_facts：交付事实的最后确认快照（#221，ADR-0011）。唯一写者是 core 的 refreshDeliveryFacts；首次 MVP 发布前不承担迁移兼容成本。
-- delivery_fact：一个执行上下文一行（键 = 工作区 + contextIdFor 的确定性 id）；没有执行上下文就没有交付事实（复合外键）。
CREATE TABLE delivery_fact (
  workspace_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  attempted_at TEXT NOT NULL, -- 最近一次写入本行的刷新尝试的乱序令牌：取读取开始时的墙钟、已提交令牌加 1 毫秒与同一个 core 上下文对象上一次发出的令牌加 1 毫秒的最大值，可能领先墙钟，只用来定序，不是读取开始时刻，不得展示
  sets_json TEXT NOT NULL CHECK (json_valid(sets_json) AND json_type(sets_json) = 'array'), -- 四个集合的节点、confirmedAt 与 stale；core 写入，storage 不解释
  PRIMARY KEY (workspace_id, context_id),
  FOREIGN KEY (workspace_id, context_id) REFERENCES execution_context (workspace_id, id)
);
