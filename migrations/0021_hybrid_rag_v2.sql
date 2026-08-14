CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE rag_index_state AS ENUM ('building','ready','active','failed','superseded');
CREATE TYPE rag_source_kind AS ENUM ('material','approved_wiki','repository_markdown','repository_pdf');
CREATE TYPE rag_source_state AS ENUM ('queued','processing','ready','ready_with_warnings','active','failed','superseded','revoked');

CREATE TABLE rag_index_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state rag_index_state NOT NULL DEFAULT 'building',
  config_fingerprint text NOT NULL CHECK (config_fingerprint ~ '^[0-9a-f]{64}$'),
  chunking_version text NOT NULL,
  embedding_provider text NOT NULL,
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions=1024),
  context_prefix_version text NOT NULL,
  distance_metric text NOT NULL CHECK (distance_metric='cosine'),
  expected_source_count integer NOT NULL DEFAULT 0 CHECK (expected_source_count >= 0),
  failure_code text,
  activated_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rag_index_versions_state_idx ON rag_index_versions(state,created_at);
CREATE UNIQUE INDEX rag_index_versions_one_active_idx ON rag_index_versions(state) WHERE state='active';
CREATE UNIQUE INDEX rag_index_versions_open_fingerprint_idx ON rag_index_versions(config_fingerprint) WHERE state IN ('building','ready','active');

CREATE TABLE rag_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_kind rag_source_kind NOT NULL,
  source_id uuid NOT NULL,
  source_revision text NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 2048),
  index_version_id uuid NOT NULL REFERENCES rag_index_versions(id) ON DELETE CASCADE,
  state rag_source_state NOT NULL DEFAULT 'queued',
  visibility visibility NOT NULL,
  evidence_family_id text NOT NULL CHECK (evidence_family_id ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  warning_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warning_codes)='array'),
  parent_count integer NOT NULL DEFAULT 0 CHECK (parent_count >= 0),
  child_count integer NOT NULL DEFAULT 0 CHECK (child_count >= 0),
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  failure_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(index_version_id,owner_id,source_kind,source_id,source_revision),
  UNIQUE(id,owner_id,index_version_id)
);
CREATE INDEX rag_source_versions_lease_idx ON rag_source_versions(state,lease_expires_at,created_at);
CREATE INDEX rag_source_versions_source_idx ON rag_source_versions(owner_id,source_kind,source_id,state);

CREATE TABLE rag_parent_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  index_version_id uuid NOT NULL REFERENCES rag_index_versions(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL,
  stable_key text NOT NULL CHECK (stable_key ~ '^[0-9a-f]{64}$'),
  position integer NOT NULL CHECK (position >= 0),
  content text NOT NULL CHECK (length(content)>0),
  token_count integer NOT NULL CHECK (token_count > 0),
  structure_path text NOT NULL,
  source_range jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_range)='object'),
  content_checksum text NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(source_version_id,owner_id,index_version_id) REFERENCES rag_source_versions(id,owner_id,index_version_id) ON DELETE CASCADE,
  UNIQUE(source_version_id,stable_key),
  UNIQUE(id,owner_id,index_version_id,source_version_id)
);
CREATE INDEX rag_parent_chunks_source_idx ON rag_parent_chunks(source_version_id,position);

CREATE TABLE rag_child_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  index_version_id uuid NOT NULL REFERENCES rag_index_versions(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  stable_key text NOT NULL CHECK (stable_key ~ '^[0-9a-f]{64}$'),
  position integer NOT NULL CHECK (position >= 0),
  content text NOT NULL CHECK (length(content)>0),
  contextual_content text NOT NULL CHECK (length(contextual_content)>0),
  token_count integer NOT NULL CHECK (token_count > 0),
  source_range jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_range)='object'),
  content_checksum text NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',contextual_content)) STORED,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(source_version_id,owner_id,index_version_id) REFERENCES rag_source_versions(id,owner_id,index_version_id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id,owner_id,index_version_id,source_version_id) REFERENCES rag_parent_chunks(id,owner_id,index_version_id,source_version_id) ON DELETE CASCADE,
  UNIQUE(source_version_id,stable_key),
  UNIQUE(id,owner_id,index_version_id,source_version_id)
);
CREATE INDEX rag_child_chunks_parent_idx ON rag_child_chunks(parent_id,position);
CREATE INDEX rag_child_chunks_source_idx ON rag_child_chunks(source_version_id,position);
CREATE INDEX rag_child_chunks_search_idx ON rag_child_chunks USING gin(search_vector);
CREATE INDEX rag_child_chunks_content_trgm_idx ON rag_child_chunks USING gin(content gin_trgm_ops);

ALTER TABLE repositories
  ADD COLUMN rag_index_state text NOT NULL DEFAULT 'not_indexed'
    CHECK (rag_index_state IN ('not_indexed','indexing','ready','ready_with_warnings','failed','stale')),
  ADD COLUMN rag_index_commit_sha text CHECK (rag_index_commit_sha IS NULL OR rag_index_commit_sha ~ '^[0-9a-f]{40}$'),
  ADD COLUMN rag_indexed_file_count integer NOT NULL DEFAULT 0 CHECK (rag_indexed_file_count >= 0),
  ADD COLUMN rag_skipped_file_count integer NOT NULL DEFAULT 0 CHECK (rag_skipped_file_count >= 0),
  ADD COLUMN rag_index_warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rag_index_warnings)='array'),
  ADD COLUMN rag_index_error_code text;

CREATE TABLE rag_message_citations (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL,
  index_version_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_kind rag_source_kind NOT NULL,
  source_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank > 0),
  content_checksum text NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,evidence_id),
  UNIQUE(message_id,rank)
);
CREATE INDEX rag_message_citations_owner_source_idx ON rag_message_citations(owner_id,source_kind,source_id);

CREATE TABLE rag_query_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  caller_mode text NOT NULL CHECK (caller_mode IN ('candidate_preview','public_answer')),
  policy_version text NOT NULL,
  index_version_id uuid,
  planner jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(planner)='object'),
  route_counts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(route_counts)='array'),
  selected_evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_evidence)='array'),
  coverage text NOT NULL CHECK (coverage IN ('full','partial','none','conflicted','refused','failed')),
  round_count integer NOT NULL CHECK (round_count BETWEEN 0 AND 2),
  degradations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(degradations)='array'),
  configured_evidence_tokens integer NOT NULL DEFAULT 0 CHECK (configured_evidence_tokens >= 0),
  effective_evidence_tokens integer NOT NULL DEFAULT 0 CHECK (effective_evidence_tokens >= 0),
  actual_evidence_tokens integer NOT NULL DEFAULT 0 CHECK (actual_evidence_tokens >= 0),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id)
);
CREATE INDEX rag_query_traces_owner_created_idx ON rag_query_traces(owner_id,created_at DESC);

CREATE TABLE rag_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_key text NOT NULL,
  value text NOT NULL CHECK (value IN ('up','down','correction')),
  correction text,
  labels jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(labels)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id,actor_key)
);
CREATE INDEX rag_feedback_owner_created_idx ON rag_feedback(owner_id,created_at DESC);
