CREATE TABLE knowledge_evidence (
  knowledge_item_id uuid NOT NULL,
  chunk_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (knowledge_item_id, chunk_id),
  FOREIGN KEY (knowledge_item_id, owner_id) REFERENCES knowledge_items(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (chunk_id, owner_id) REFERENCES chunks(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX knowledge_evidence_owner_idx ON knowledge_evidence(owner_id);
