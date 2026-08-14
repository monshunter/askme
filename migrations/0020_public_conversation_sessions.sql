DROP INDEX IF EXISTS conversations_public_visitor_unique;

CREATE INDEX conversations_public_visitor_sessions_idx
  ON conversations(publication_id, visitor_token_hash, last_activity_at DESC, id)
  WHERE mode='public';
