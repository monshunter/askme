ALTER TABLE conversations
  ADD COLUMN suggested_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN suggestions_context_hash text,
  ADD COLUMN suggestions_updated_at timestamptz;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_suggested_questions_array
    CHECK (jsonb_typeof(suggested_questions) = 'array' AND jsonb_array_length(suggested_questions) IN (0, 4)),
  ADD CONSTRAINT conversations_suggestions_context_hash_format
    CHECK (suggestions_context_hash IS NULL OR suggestions_context_hash ~ '^[0-9a-f]{64}$');
