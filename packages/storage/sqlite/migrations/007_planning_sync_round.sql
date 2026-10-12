-- #305：Planning 全量同步的持久提交世代，独立于 provider cursor。
CREATE TABLE planning_sync_round (
  workspace_id TEXT NOT NULL REFERENCES workspace (id),
  binding_id TEXT NOT NULL REFERENCES provider_binding (id),
  scope_key TEXT NOT NULL,
  latest_started_round INTEGER NOT NULL CHECK (latest_started_round >= 1),
  latest_committed_round INTEGER CHECK (latest_committed_round IS NULL OR (latest_committed_round >= 1 AND latest_committed_round <= latest_started_round)),
  PRIMARY KEY (workspace_id, binding_id, scope_key)
);
