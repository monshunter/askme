ALTER TABLE publications ADD CONSTRAINT publications_slug_opaque_format
  CHECK (slug ~ '^[A-Za-z0-9_-]{32}$');
ALTER TABLE publications ADD CONSTRAINT publications_state_timestamps
  CHECK (
    (status <> 'published' OR published_at IS NOT NULL) AND
    (status <> 'revoked' OR revoked_at IS NOT NULL) AND
    (status <> 'paused' OR paused_at IS NOT NULL)
  );
CREATE UNIQUE INDEX publications_owner_active_unique
  ON publications(owner_id) WHERE status IN ('draft','published','paused');
