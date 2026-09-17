PRAGMA foreign_keys = ON;

-- DeepSeek Harness Project Delivery Workspace
-- SQLite schema v0.1
-- Design goal: authoritative external facts are cached, local control facts are persisted,
-- and external identity remains distinct from project membership.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    method_preset TEXT NOT NULL DEFAULT 'basic'
        CHECK (method_preset IN ('scrum', 'kanban', 'project', 'basic')),
    status_policy TEXT NOT NULL DEFAULT 'source_managed'
        CHECK (status_policy IN ('source_managed', 'harness_managed', 'manual')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_account (
    id TEXT PRIMARY KEY,
    provider_family TEXT NOT NULL,
    external_account_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    secret_ref TEXT,
    connection_state TEXT NOT NULL DEFAULT 'unknown'
        CHECK (connection_state IN ('unknown', 'healthy', 'degraded', 'offline', 'revoked')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (provider_family, external_account_key)
);

CREATE TABLE IF NOT EXISTS provider_binding (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    domain TEXT NOT NULL
        CHECK (domain IN ('planning', 'development', 'delivery', 'execution', 'storage')),
    implementation_key TEXT NOT NULL,
    connector_account_id TEXT REFERENCES connector_account(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    health_state TEXT NOT NULL DEFAULT 'unknown'
        CHECK (health_state IN ('unknown', 'healthy', 'degraded', 'offline')),
    last_observed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_single_planning_binding
ON provider_binding(workspace_id)
WHERE domain = 'planning' AND enabled = 1;

CREATE INDEX IF NOT EXISTS ix_provider_binding_workspace_domain
ON provider_binding(workspace_id, domain, enabled);

CREATE TABLE IF NOT EXISTS provider_capability_snapshot (
    binding_id TEXT PRIMARY KEY REFERENCES provider_binding(id) ON DELETE CASCADE,
    capability_json TEXT NOT NULL DEFAULT '{}',
    permission_json TEXT NOT NULL DEFAULT '{}',
    effective_access_json TEXT NOT NULL DEFAULT '{}',
    observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
    planning_binding_id TEXT NOT NULL REFERENCES provider_binding(id),
    external_project_key TEXT,
    title TEXT NOT NULL,
    description TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS entity (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN (
        'planning_item',
        'work_item',
        'change_request',
        'repository',
        'execution_context',
        'worktree',
        'branch',
        'commit',
        'pipeline_run',
        'check_run',
        'environment',
        'deployment',
        'agent_run',
        'human_approval'
    )),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_entity_workspace_kind
ON entity(workspace_id, kind);

CREATE TABLE IF NOT EXISTS external_identity (
    id TEXT PRIMARY KEY,
    connector_account_id TEXT NOT NULL REFERENCES connector_account(id) ON DELETE CASCADE,
    object_kind TEXT NOT NULL,
    external_id TEXT NOT NULL,
    canonical_url TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (connector_account_id, object_kind, external_id)
);

CREATE TABLE IF NOT EXISTS entity_external_identity (
    entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    external_identity_id TEXT NOT NULL REFERENCES external_identity(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'primary'
        CHECK (role IN ('primary', 'alias', 'historical')),
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    PRIMARY KEY (entity_id, external_identity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_single_primary_external_identity
ON entity_external_identity(entity_id)
WHERE role = 'primary' AND valid_to IS NULL;

CREATE TABLE IF NOT EXISTS work_item (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    content_kind TEXT NOT NULL
        CHECK (content_kind IN ('issue', 'draft', 'local_task', 'jira_issue', 'other')),
    key_text TEXT,
    title TEXT NOT NULL,
    body TEXT,
    content_state TEXT,
    labels_json TEXT NOT NULL DEFAULT '[]',
    source_version TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS ix_work_item_key_text
ON work_item(key_text);

CREATE TABLE IF NOT EXISTS change_request (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    repository_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    number_text TEXT,
    title TEXT NOT NULL,
    source_branch_name TEXT,
    target_branch_name TEXT,
    state TEXT NOT NULL,
    draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),
    merge_state TEXT,
    author_ref TEXT,
    review_summary_json TEXT NOT NULL DEFAULT '{}',
    source_version TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS iteration (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    external_id TEXT,
    title TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    state TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (project_id, external_id)
);

CREATE TABLE IF NOT EXISTS milestone (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    external_id TEXT,
    title TEXT NOT NULL,
    target_date TEXT,
    state TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (project_id, external_id)
);

CREATE TABLE IF NOT EXISTS planning_item (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    content_kind TEXT NOT NULL
        CHECK (content_kind IN ('work_item', 'change_request', 'redacted')),
    content_entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    native_status_key TEXT,
    native_status_name TEXT,
    normalized_status TEXT
        CHECK (normalized_status IS NULL OR normalized_status IN ('unstarted', 'started', 'completed', 'canceled')),
    priority_text TEXT,
    assignees_json TEXT NOT NULL DEFAULT '[]',
    iteration_id TEXT REFERENCES iteration(id) ON DELETE SET NULL,
    milestone_id TEXT REFERENCES milestone(id) ON DELETE SET NULL,
    rank_text TEXT,
    start_date TEXT,
    target_date TEXT,
    custom_fields_json TEXT NOT NULL DEFAULT '{}',
    source_version TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    CHECK (
        (content_kind = 'redacted' AND content_entity_id IS NULL)
        OR
        (content_kind IN ('work_item', 'change_request') AND content_entity_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_planning_item_project_status
ON planning_item(project_id, normalized_status);

CREATE INDEX IF NOT EXISTS ix_planning_item_project_iteration
ON planning_item(project_id, iteration_id);

CREATE INDEX IF NOT EXISTS ix_planning_item_content_entity
ON planning_item(content_entity_id);

CREATE TABLE IF NOT EXISTS planning_status_mapping (
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    native_status_key TEXT NOT NULL,
    native_status_name TEXT NOT NULL,
    normalized_status TEXT NOT NULL
        CHECK (normalized_status IN ('unstarted', 'started', 'completed', 'canceled')),
    PRIMARY KEY (workspace_id, native_status_key)
);

CREATE TABLE IF NOT EXISTS planning_field_mapping (
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    semantic_key TEXT NOT NULL,
    provider_field_id TEXT NOT NULL,
    provider_field_name TEXT,
    data_type TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (workspace_id, semantic_key)
);

CREATE TABLE IF NOT EXISTS repository (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL,
    default_branch TEXT,
    remote_url TEXT,
    local_path TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS workspace_repository (
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    development_binding_id TEXT NOT NULL REFERENCES provider_binding(id),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    PRIMARY KEY (workspace_id, repository_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_workspace_default_repository
ON workspace_repository(workspace_id)
WHERE is_default = 1 AND enabled = 1;

CREATE TABLE IF NOT EXISTS execution_context (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    work_item_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES entity(id),
    execution_binding_id TEXT REFERENCES provider_binding(id),
    state TEXT NOT NULL
        CHECK (state IN ('pending', 'active', 'manual_fallback', 'completed', 'failed', 'canceled')),
    base_branch TEXT NOT NULL,
    primary_branch_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    worktree_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    created_by TEXT,
    failure_code TEXT,
    failure_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_execution_context_work_item
ON execution_context(work_item_id, state);

CREATE TABLE IF NOT EXISTS worktree (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    branch_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    exists_now INTEGER NOT NULL DEFAULT 1 CHECK (exists_now IN (0, 1)),
    dirty_state TEXT,
    created_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (repository_id, path)
);

CREATE TABLE IF NOT EXISTS branch (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    head_sha TEXT,
    is_remote INTEGER NOT NULL DEFAULT 0 CHECK (is_remote IN (0, 1)),
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (repository_id, name, is_remote)
);

CREATE TABLE IF NOT EXISTS commit_obj (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    repository_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    sha TEXT NOT NULL,
    summary TEXT,
    author_ref TEXT,
    committed_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (repository_id, sha)
);

CREATE TABLE IF NOT EXISTS change_request_commit (
    change_request_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    commit_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    PRIMARY KEY (change_request_id, commit_id)
);

CREATE TABLE IF NOT EXISTS pipeline_run (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    repository_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    head_sha TEXT,
    name TEXT NOT NULL,
    status TEXT,
    conclusion TEXT,
    started_at TEXT,
    completed_at TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS ix_pipeline_run_repo_sha
ON pipeline_run(repository_id, head_sha);

CREATE TABLE IF NOT EXISTS check_run (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    pipeline_run_id TEXT REFERENCES entity(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT,
    conclusion TEXT,
    started_at TEXT,
    completed_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS environment (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    environment_type TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS deployment (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    environment_id TEXT NOT NULL REFERENCES entity(id),
    repository_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    commit_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    pipeline_run_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    status TEXT,
    deployment_url TEXT,
    deployed_at TEXT,
    source_updated_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS agent_run (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    execution_context_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    execution_binding_id TEXT NOT NULL REFERENCES provider_binding(id),
    external_session_key TEXT,
    state TEXT NOT NULL
        CHECK (state IN ('idle', 'running', 'paused', 'failed', 'completed', 'canceled')),
    started_at TEXT,
    completed_at TEXT,
    observed_at TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS human_approval (
    id TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
    subject_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    approval_type TEXT NOT NULL,
    state TEXT NOT NULL
        CHECK (state IN ('pending', 'approved', 'rejected', 'canceled')),
    approver_ref TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_relation (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    source_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    relation_class TEXT NOT NULL
        CHECK (relation_class IN ('business_semantic', 'system_fact', 'planning')),
    provenance TEXT NOT NULL
        CHECK (provenance IN ('provider_native', 'harness_created', 'user_manual', 'deterministic_confirmed')),
    provider_binding_id TEXT REFERENCES provider_binding(id) ON DELETE SET NULL,
    external_relation_key TEXT,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'superseded', 'removed')),
    created_by TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    CHECK (source_entity_id <> target_entity_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_artifact_relation_active
ON artifact_relation(
    workspace_id,
    source_entity_id,
    target_entity_id,
    relation_type,
    provenance
)
WHERE state = 'active';

CREATE INDEX IF NOT EXISTS ix_artifact_relation_source
ON artifact_relation(source_entity_id, relation_type, state);

CREATE INDEX IF NOT EXISTS ix_artifact_relation_target
ON artifact_relation(target_entity_id, relation_type, state);

CREATE TABLE IF NOT EXISTS candidate_relation (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    source_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
    proposed_relation_type TEXT NOT NULL,
    detector_key TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'confirmed', 'ignored', 'expired')),
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    CHECK (source_entity_id <> target_entity_id)
);

CREATE INDEX IF NOT EXISTS ix_candidate_relation_workspace_state
ON candidate_relation(workspace_id, state);

CREATE TABLE IF NOT EXISTS sync_cursor (
    binding_id TEXT NOT NULL REFERENCES provider_binding(id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL,
    cursor_value TEXT,
    state TEXT NOT NULL DEFAULT 'idle'
        CHECK (state IN ('idle', 'syncing', 'healthy', 'degraded', 'failed')),
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error_code TEXT,
    last_error_detail TEXT,
    PRIMARY KEY (binding_id, scope_key)
);

CREATE TABLE IF NOT EXISTS provider_event (
    id TEXT PRIMARY KEY,
    binding_id TEXT NOT NULL REFERENCES provider_binding(id) ON DELETE CASCADE,
    dedupe_key TEXT NOT NULL,
    external_event_id TEXT,
    event_type TEXT NOT NULL,
    subject_external_key TEXT,
    event_time TEXT,
    received_at TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    processing_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_state IN ('pending', 'processed', 'ignored', 'failed')),
    processed_at TEXT,
    error_code TEXT,
    error_detail TEXT,
    UNIQUE (binding_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS ix_provider_event_pending
ON provider_event(binding_id, processing_state, received_at);

CREATE TABLE IF NOT EXISTS mutation_attempt (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL REFERENCES provider_binding(id),
    target_entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    command_name TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    state TEXT NOT NULL
        CHECK (state IN ('validating', 'writing', 'confirmed', 'reconciled', 'failed', 'unknown', 'conflict')),
    expected_source_version TEXT,
    request_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    error_detail TEXT,
    provider_request_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_mutation_attempt_state
ON mutation_attempt(workspace_id, state, updated_at);

CREATE TABLE IF NOT EXISTS activity_event (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    domain TEXT NOT NULL
        CHECK (domain IN ('planning', 'development', 'delivery', 'execution', 'relation', 'system')),
    subject_entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
    binding_id TEXT REFERENCES provider_binding(id) ON DELETE SET NULL,
    event_kind TEXT NOT NULL,
    fact_type TEXT NOT NULL,
    derived INTEGER NOT NULL DEFAULT 0 CHECK (derived IN (0, 1)),
    actor_ref TEXT,
    event_time TEXT NOT NULL,
    received_time TEXT NOT NULL,
    source_ref TEXT,
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    detail_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS ix_activity_event_workspace_time
ON activity_event(workspace_id, event_time DESC);


CREATE TRIGGER IF NOT EXISTS trg_planning_item_content_kind_insert
BEFORE INSERT ON planning_item
FOR EACH ROW
WHEN NEW.content_entity_id IS NOT NULL
BEGIN
    SELECT CASE
        WHEN NEW.content_kind = 'work_item'
             AND (SELECT kind FROM entity WHERE id = NEW.content_entity_id) <> 'work_item'
        THEN RAISE(ABORT, 'planning_item content_kind work_item requires work_item entity')
        WHEN NEW.content_kind = 'change_request'
             AND (SELECT kind FROM entity WHERE id = NEW.content_entity_id) <> 'change_request'
        THEN RAISE(ABORT, 'planning_item content_kind change_request requires change_request entity')
    END;

    SELECT CASE
        WHEN (SELECT workspace_id FROM entity WHERE id = NEW.id)
             <> (SELECT workspace_id FROM entity WHERE id = NEW.content_entity_id)
        THEN RAISE(ABORT, 'planning_item content entity must belong to the same workspace')
    END;
END;

CREATE TRIGGER IF NOT EXISTS trg_planning_item_content_kind_update
BEFORE UPDATE OF content_kind, content_entity_id ON planning_item
FOR EACH ROW
WHEN NEW.content_entity_id IS NOT NULL
BEGIN
    SELECT CASE
        WHEN NEW.content_kind = 'work_item'
             AND (SELECT kind FROM entity WHERE id = NEW.content_entity_id) <> 'work_item'
        THEN RAISE(ABORT, 'planning_item content_kind work_item requires work_item entity')
        WHEN NEW.content_kind = 'change_request'
             AND (SELECT kind FROM entity WHERE id = NEW.content_entity_id) <> 'change_request'
        THEN RAISE(ABORT, 'planning_item content_kind change_request requires change_request entity')
    END;

    SELECT CASE
        WHEN (SELECT workspace_id FROM entity WHERE id = NEW.id)
             <> (SELECT workspace_id FROM entity WHERE id = NEW.content_entity_id)
        THEN RAISE(ABORT, 'planning_item content entity must belong to the same workspace')
    END;
END;

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (1, CURRENT_TIMESTAMP);
