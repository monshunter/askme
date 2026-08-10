CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE user_role AS ENUM ('candidate', 'admin');
CREATE TYPE account_status AS ENUM ('active', 'suspended');
CREATE TYPE material_kind AS ENUM ('file', 'github', 'notion', 'website');
CREATE TYPE material_status AS ENUM ('queued', 'processing', 'indexed', 'failed');
CREATE TYPE visibility AS ENUM ('private', 'agent_only', 'citation_allowed', 'public_preview');
CREATE TYPE job_status AS ENUM ('queued', 'processing', 'completed', 'failed');
CREATE TYPE knowledge_type AS ENUM ('project', 'experience', 'skill', 'article', 'repository', 'summary');
CREATE TYPE knowledge_status AS ENUM ('active', 'archived');
CREATE TYPE publication_status AS ENUM ('draft', 'published', 'revoked', 'paused');
CREATE TYPE conversation_mode AS ENUM ('preview', 'public');
CREATE TYPE message_role AS ENUM ('user', 'assistant');
CREATE TYPE message_status AS ENUM ('pending', 'completed', 'failed');
CREATE TYPE feedback_value AS ENUM ('up', 'down');
CREATE TYPE flag_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE flag_status AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role user_role NOT NULL,
  status account_status NOT NULL DEFAULT 'active',
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'zh-CN')),
  display_name text NOT NULL,
  headline text,
  location text,
  bio text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, role)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind material_kind NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  original_name text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 52428800),
  storage_path text,
  external_url text,
  source_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status material_status NOT NULL DEFAULT 'queued',
  visibility visibility NOT NULL DEFAULT 'private',
  content_checksum text,
  summary text,
  processing_version integer NOT NULL DEFAULT 1,
  error_code text,
  error_message text,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  CHECK ((kind = 'file' AND storage_path IS NOT NULL) OR (kind <> 'file' AND external_url IS NOT NULL AND storage_path IS NOT NULL))
);
CREATE INDEX materials_owner_status_idx ON materials(owner_id, status);

CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_owner text,
  lease_expires_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (material_id, owner_id) REFERENCES materials(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX ingestion_jobs_due_idx ON ingestion_jobs(status, next_run_at);

CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY,
  version text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  content text NOT NULL CHECK (length(content) > 0),
  token_estimate integer NOT NULL CHECK (token_estimate > 0),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, position),
  UNIQUE (id, owner_id),
  FOREIGN KEY (material_id, owner_id) REFERENCES materials(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX chunks_owner_idx ON chunks(owner_id);
CREATE INDEX chunks_search_idx ON chunks USING gin(search_vector);
CREATE INDEX chunks_content_trgm_idx ON chunks USING gin(content gin_trgm_ops);

CREATE TABLE knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type knowledge_type NOT NULL,
  status knowledge_status NOT NULL DEFAULT 'active',
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  summary text NOT NULL,
  highlights jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(highlights) = 'array'),
  confidence real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || summary)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX knowledge_items_owner_type_idx ON knowledge_items(owner_id, type);
CREATE INDEX knowledge_items_search_idx ON knowledge_items USING gin(search_vector);

CREATE TABLE knowledge_sources (
  knowledge_item_id uuid NOT NULL,
  material_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (knowledge_item_id, material_id),
  FOREIGN KEY (knowledge_item_id, owner_id) REFERENCES knowledge_items(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (material_id, owner_id) REFERENCES materials(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX knowledge_sources_owner_idx ON knowledge_sources(owner_id);

CREATE TABLE privacy_confirmations (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  policy_revision integer NOT NULL CHECK (policy_revision > 0),
  confirmed_at timestamptz NOT NULL
);

CREATE TABLE agent_settings (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  answer_tone text NOT NULL DEFAULT 'professional' CHECK (answer_tone IN ('professional', 'concise', 'conversational')),
  public_mode boolean NOT NULL DEFAULT false,
  privacy_safe_mode boolean NOT NULL DEFAULT true,
  suggested_questions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggested_questions) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[A-Za-z0-9_-]{20,80}$'),
  status publication_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  revoked_at timestamptz,
  paused_at timestamptz,
  pause_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX publications_owner_idx ON publications(owner_id);
CREATE UNIQUE INDEX publications_one_current_per_owner ON publications(owner_id) WHERE status IN ('published', 'paused');

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  publication_id uuid,
  mode conversation_mode NOT NULL,
  visitor_token_hash text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (publication_id, owner_id) REFERENCES publications(id, owner_id) ON DELETE CASCADE,
  CHECK ((mode = 'preview' AND publication_id IS NULL AND visitor_token_hash IS NULL) OR (mode = 'public' AND publication_id IS NOT NULL AND visitor_token_hash IS NOT NULL))
);
CREATE INDEX conversations_publication_idx ON conversations(publication_id);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  role message_role NOT NULL,
  status message_status NOT NULL DEFAULT 'completed',
  content text NOT NULL,
  model text,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

CREATE TABLE message_citations (
  message_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank > 0),
  excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, chunk_id),
  FOREIGN KEY (message_id, owner_id) REFERENCES messages(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id, owner_id) REFERENCES chunks(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE answer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_key text NOT NULL,
  value feedback_value NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, actor_key)
);

CREATE TABLE content_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid REFERENCES publications(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  category text NOT NULL,
  severity flag_severity NOT NULL,
  status flag_status NOT NULL DEFAULT 'open',
  safe_summary text NOT NULL,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (publication_id IS NOT NULL OR message_id IS NOT NULL)
);
CREATE INDEX content_flags_status_idx ON content_flags(status, severity);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  outcome text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_id, created_at);
CREATE INDEX audit_events_target_idx ON audit_events(target_type, target_id);

CREATE TABLE ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  model text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  outcome text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_created_idx ON ai_usage(created_at);

CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
