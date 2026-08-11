ALTER TABLE messages ADD COLUMN source_invalidated_at timestamptz;

CREATE FUNCTION invalidate_answers_for_deleted_chunk() RETURNS trigger AS $$
BEGIN
  UPDATE messages
  SET source_invalidated_at=coalesce(source_invalidated_at,now())
  WHERE id IN (SELECT message_id FROM message_citations WHERE chunk_id=OLD.id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_invalidate_cited_answers
  BEFORE DELETE ON chunks
  FOR EACH ROW EXECUTE FUNCTION invalidate_answers_for_deleted_chunk();
