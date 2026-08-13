CREATE TYPE repository_revision_state AS ENUM ('staging','stored','failed','collected');
CREATE TYPE repository_sync_job_state AS ENUM ('pending','running','completed','failed','cancelled');
CREATE TYPE repository_dossier_state AS ENUM ('generating','review_pending','failed','disabled');
CREATE TYPE repository_projection_state AS ENUM ('draft','approved','superseded','disabled');
CREATE TYPE repository_claim_category AS ENUM ('overview','implemented_behavior','architecture','api','module','data_security','operations','limitation');
CREATE TYPE analysis_run_purpose AS ENUM ('repository_analysis','conversation_analysis');
CREATE TYPE analysis_run_state AS ENUM ('pending','running','completed','failed','cancelled');
CREATE TYPE analysis_outcome AS ENUM ('answered','insufficient','refused');

CREATE TABLE repository_artifacts (
  content_key text PRIMARY KEY CHECK (content_key ~ '^[0-9a-f]{64}$'),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  manifest_checksum text NOT NULL CHECK (manifest_checksum ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL CHECK (length(btrim(storage_path)) > 0),
  compressed_bytes bigint NOT NULL CHECK (compressed_bytes >= 0),
  extracted_bytes bigint NOT NULL CHECK (extracted_bytes >= 0),
  file_count integer NOT NULL CHECK (file_count >= 0),
  reference_count integer NOT NULL DEFAULT 0 CHECK (reference_count >= 0),
  retention_until timestamptz,
  gc_eligible_at timestamptz,
  gc_lease_owner text,
  gc_lease_expires_at timestamptz,
  gc_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repository_artifacts_gc_idx ON repository_artifacts(gc_eligible_at,gc_lease_expires_at) WHERE gc_eligible_at IS NOT NULL;

CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'github' CHECK (provider='github'),
  canonical_url text NOT NULL CHECK (canonical_url ~ '^https://github\.com/[^/]+/[^/]+$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  visibility visibility NOT NULL DEFAULT 'private',
  public_deep_analysis_enabled boolean NOT NULL DEFAULT false,
  active_revision_id uuid,
  active_projection_id uuid,
  analysis_generation integer NOT NULL DEFAULT 0 CHECK (analysis_generation >= 0),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,owner_id),
  UNIQUE(owner_id,canonical_url)
);
CREATE INDEX repositories_owner_visibility_idx ON repositories(owner_id,visibility);

CREATE TABLE repository_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  requested_ref text NOT NULL CHECK (length(btrim(requested_ref)) BETWEEN 1 AND 255),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  archive_checksum text NOT NULL CHECK (archive_checksum ~ '^[0-9a-f]{64}$'),
  artifact_key text REFERENCES repository_artifacts(content_key) ON DELETE RESTRICT,
  filter_version integer NOT NULL DEFAULT 1 CHECK (filter_version > 0),
  filter_fingerprint text NOT NULL CHECK (filter_fingerprint ~ '^[0-9a-f]{64}$'),
  exclude_patterns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exclude_patterns)='array'),
  archive_bytes bigint NOT NULL CHECK (archive_bytes >= 0),
  extracted_bytes bigint NOT NULL CHECK (extracted_bytes >= 0),
  file_count integer NOT NULL CHECK (file_count >= 0),
  state repository_revision_state NOT NULL DEFAULT 'staging',
  error_code text,
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,owner_id),
  UNIQUE(repository_id,commit_sha,filter_fingerprint),
  FOREIGN KEY(repository_id,owner_id) REFERENCES repositories(id,owner_id) ON DELETE CASCADE,
  CHECK (
    (state='staging' AND stored_at IS NULL AND error_code IS NULL) OR
    (state='stored' AND artifact_key IS NOT NULL AND stored_at IS NOT NULL AND error_code IS NULL) OR
    (state='failed' AND artifact_key IS NULL AND error_code IS NOT NULL) OR
    (state='collected' AND artifact_key IS NULL AND stored_at IS NOT NULL AND error_code IS NULL)
  )
);
CREATE INDEX repository_revisions_repository_created_idx ON repository_revisions(repository_id,created_at DESC);

CREATE TABLE repository_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key)=64),
  state repository_sync_job_state NOT NULL DEFAULT 'pending',
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  safe_error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(repository_id,owner_id) REFERENCES repositories(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id,owner_id) REFERENCES repository_revisions(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX repository_sync_jobs_due_idx ON repository_sync_jobs(state,created_at);

CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose analysis_run_purpose NOT NULL,
  repository_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  assistant_message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key)=64),
  analysis_generation integer NOT NULL DEFAULT 0 CHECK (analysis_generation >= 0),
  state analysis_run_state NOT NULL DEFAULT 'pending',
  outcome analysis_outcome,
  priority integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  phase text NOT NULL DEFAULT 'pending',
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  cancel_reason text,
  budget_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(budget_snapshot)='object'),
  usage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage)='object'),
  image_digest text NOT NULL,
  skill_hash text NOT NULL CHECK (length(skill_hash)=64),
  prompt_version text NOT NULL,
  profile_id text NOT NULL CHECK (profile_id IN ('router','rag','code')),
  profile_fingerprint text NOT NULL CHECK (length(profile_fingerprint)=64),
  configured_model text NOT NULL,
  actual_model text,
  microvm_id text,
  safe_error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  cleanup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(repository_id,owner_id) REFERENCES repositories(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id,owner_id) REFERENCES repository_revisions(id,owner_id) ON DELETE RESTRICT,
  CHECK (
    (purpose='repository_analysis' AND conversation_id IS NULL AND assistant_message_id IS NULL) OR
    (purpose='conversation_analysis' AND conversation_id IS NOT NULL AND assistant_message_id IS NOT NULL)
  ),
  CHECK (outcome IS NULL OR state='completed'),
  CHECK (state <> 'completed' OR (finished_at IS NOT NULL AND cleanup_completed_at IS NOT NULL))
);
CREATE INDEX analysis_runs_lease_idx ON analysis_runs(state,priority DESC,lease_expires_at);
CREATE INDEX analysis_runs_repository_idx ON analysis_runs(repository_id,created_at DESC);
CREATE INDEX analysis_runs_conversation_idx ON analysis_runs(conversation_id,created_at DESC) WHERE conversation_id IS NOT NULL;

CREATE TABLE repository_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  analysis_run_id uuid UNIQUE REFERENCES analysis_runs(id) ON DELETE SET NULL,
  generated_version integer NOT NULL CHECK (generated_version > 0),
  analysis_generation integer NOT NULL CHECK (analysis_generation >= 0),
  state repository_dossier_state NOT NULL DEFAULT 'generating',
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage)='object'),
  image_digest text NOT NULL,
  skill_hash text NOT NULL CHECK (length(skill_hash)=64),
  prompt_version text NOT NULL,
  profile_fingerprint text NOT NULL CHECK (length(profile_fingerprint)=64),
  configured_model text NOT NULL,
  actual_model text,
  outdated_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,owner_id),
  UNIQUE(revision_id,generated_version),
  FOREIGN KEY(repository_id,owner_id) REFERENCES repositories(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id,owner_id) REFERENCES repository_revisions(id,owner_id) ON DELETE CASCADE
);
CREATE INDEX repository_dossiers_review_idx ON repository_dossiers(repository_id,state,created_at DESC);

CREATE TABLE repository_dossier_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES repository_dossiers(id) ON DELETE CASCADE,
  category repository_claim_category NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  statement_markdown text NOT NULL CHECK (length(btrim(statement_markdown)) BETWEEN 1 AND 8000),
  visibility visibility NOT NULL DEFAULT 'agent_only',
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dossier_id,sort_order)
);

CREATE TABLE repository_dossier_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES repository_dossier_claims(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES repository_revisions(id) ON DELETE RESTRICT,
  rank integer NOT NULL CHECK (rank > 0),
  path text NOT NULL CHECK (octet_length(path) <= 1024),
  line_start integer NOT NULL CHECK (line_start > 0),
  line_end integer NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(claim_id,rank),
  CHECK (line_end >= line_start AND line_end-line_start+1 <= 200)
);

CREATE TABLE repository_dossier_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES repository_dossiers(id) ON DELETE CASCADE,
  state repository_projection_state NOT NULL DEFAULT 'draft',
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  superseded_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state='draft' AND approved_at IS NULL AND superseded_at IS NULL AND disabled_at IS NULL) OR
    (state='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND superseded_at IS NULL AND disabled_at IS NULL) OR
    (state='superseded' AND approved_at IS NOT NULL AND superseded_at IS NOT NULL AND disabled_at IS NULL) OR
    (state='disabled' AND disabled_at IS NOT NULL)
  )
);
CREATE INDEX repository_dossier_projections_state_idx ON repository_dossier_projections(dossier_id,state);
CREATE UNIQUE INDEX repository_dossier_projections_one_draft_idx ON repository_dossier_projections(dossier_id) WHERE state='draft';

CREATE TABLE repository_dossier_projection_claims (
  projection_id uuid NOT NULL REFERENCES repository_dossier_projections(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL REFERENCES repository_dossier_claims(id) ON DELETE CASCADE,
  edited_statement_markdown text CHECK (edited_statement_markdown IS NULL OR length(btrim(edited_statement_markdown)) BETWEEN 1 AND 8000),
  effective_visibility visibility NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(projection_id,claim_id)
);

CREATE TABLE repository_message_citations (
  message_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank > 0),
  path text NOT NULL CHECK (octet_length(path) <= 1024),
  line_start integer NOT NULL CHECK (line_start > 0),
  line_end integer NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,rank),
  FOREIGN KEY(message_id,owner_id) REFERENCES messages(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(repository_id,owner_id) REFERENCES repositories(id,owner_id) ON DELETE CASCADE,
  FOREIGN KEY(revision_id,owner_id) REFERENCES repository_revisions(id,owner_id) ON DELETE RESTRICT,
  CHECK (line_end >= line_start AND line_end-line_start+1 <= 200)
);

CREATE TABLE analysis_run_events (
  run_id uuid NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  state analysis_run_state NOT NULL,
  phase text NOT NULL,
  safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,version)
);

ALTER TABLE repositories
  ADD CONSTRAINT repositories_active_revision_fk FOREIGN KEY(active_revision_id) REFERENCES repository_revisions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT repositories_active_projection_fk FOREIGN KEY(active_projection_id) REFERENCES repository_dossier_projections(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
