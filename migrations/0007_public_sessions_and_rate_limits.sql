ALTER TABLE conversations ADD CONSTRAINT conversations_public_session_fields
  CHECK (
    mode <> 'public' OR
    (publication_id IS NOT NULL AND visitor_token_hash IS NOT NULL AND expires_at IS NOT NULL)
  );
CREATE UNIQUE INDEX conversations_public_visitor_unique
  ON conversations(publication_id,visitor_token_hash) WHERE mode='public';

CREATE TABLE public_rate_limits (
  scope_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX public_rate_limits_updated_idx ON public_rate_limits(updated_at);
