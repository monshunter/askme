ALTER TABLE knowledge_items
  ADD COLUMN featured_at timestamptz;

CREATE INDEX knowledge_items_owner_featured_idx
  ON knowledge_items(owner_id, featured_at)
  WHERE featured_at IS NOT NULL;
