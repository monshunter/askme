DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM materials WHERE kind='github') THEN
    RAISE EXCEPTION USING
      ERRCODE='P0001',
      MESSAGE='legacy github materials must be explicitly removed before applying 0013_remove_github_material_kind.sql';
  END IF;
END
$$;

ALTER TABLE materials DROP CONSTRAINT materials_check;
ALTER TYPE material_kind RENAME TO material_kind_legacy;
CREATE TYPE material_kind AS ENUM ('file','notion','website');
ALTER TABLE materials
  ALTER COLUMN kind TYPE material_kind
  USING kind::text::material_kind;
DROP TYPE material_kind_legacy;
ALTER TABLE materials ADD CONSTRAINT materials_storage_contract
  CHECK ((kind='file' AND storage_path IS NOT NULL) OR (kind<>'file' AND external_url IS NOT NULL AND storage_path IS NOT NULL));
