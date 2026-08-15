ALTER TABLE knowledge_items
  ADD COLUMN entities jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(entities)='array');
