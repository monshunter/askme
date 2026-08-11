ALTER TABLE conversations ADD COLUMN suggestion_cursor integer NOT NULL DEFAULT 0
  CHECK (suggestion_cursor >= 0);
