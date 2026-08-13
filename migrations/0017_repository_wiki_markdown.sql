ALTER TABLE repository_dossiers
  ADD COLUMN wiki_title text,
  ADD COLUMN wiki_summary text,
  ADD COLUMN wiki_manifest jsonb,
  ADD CONSTRAINT repository_dossiers_wiki_title_check CHECK (wiki_title IS NULL OR length(btrim(wiki_title)) BETWEEN 1 AND 300),
  ADD CONSTRAINT repository_dossiers_wiki_summary_check CHECK (wiki_summary IS NULL OR length(btrim(wiki_summary)) BETWEEN 1 AND 4000),
  ADD CONSTRAINT repository_dossiers_wiki_manifest_check CHECK (wiki_manifest IS NULL OR jsonb_typeof(wiki_manifest)='object');

CREATE TABLE repository_wiki_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES repository_dossiers(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (
    path ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}\.md$'
    AND path !~ '(^|/)\.{1,2}(/|$)'
    AND path !~ '(^|/)\.'
  ),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  generated_markdown text NOT NULL CHECK (length(btrim(generated_markdown)) BETWEEN 200 AND 500000),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dossier_id,path),
  UNIQUE(dossier_id,sort_order),
  UNIQUE(id,dossier_id)
);

CREATE TABLE repository_wiki_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES repository_dossiers(id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  revision_id uuid NOT NULL REFERENCES repository_revisions(id) ON DELETE RESTRICT,
  marker text NOT NULL CHECK (marker ~ '^S[1-9][0-9]{0,3}$'),
  rank integer NOT NULL CHECK (rank > 0),
  path text NOT NULL CHECK (octet_length(path) <= 1024),
  line_start integer NOT NULL CHECK (line_start > 0),
  line_end integer NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(page_id,dossier_id) REFERENCES repository_wiki_pages(id,dossier_id) ON DELETE CASCADE,
  UNIQUE(dossier_id,marker),
  UNIQUE(dossier_id,rank),
  CHECK (line_end >= line_start AND line_end-line_start+1 <= 200)
);
CREATE INDEX repository_wiki_citations_revision_idx ON repository_wiki_citations(revision_id);

ALTER TABLE repository_dossier_projections
  ADD CONSTRAINT repository_dossier_projections_id_dossier_unique UNIQUE(id,dossier_id);

CREATE TABLE repository_wiki_projection_pages (
  projection_id uuid NOT NULL,
  page_id uuid NOT NULL,
  dossier_id uuid NOT NULL REFERENCES repository_dossiers(id) ON DELETE CASCADE,
  edited_markdown text CHECK (edited_markdown IS NULL OR length(btrim(edited_markdown)) BETWEEN 200 AND 500000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(projection_id,page_id),
  FOREIGN KEY(projection_id,dossier_id) REFERENCES repository_dossier_projections(id,dossier_id) ON DELETE CASCADE,
  FOREIGN KEY(page_id,dossier_id) REFERENCES repository_wiki_pages(id,dossier_id) ON DELETE CASCADE
);

UPDATE repository_dossiers
SET outdated_reason='wiki_contract_v1_required',updated_at=now()
WHERE wiki_manifest IS NULL AND outdated_reason IS NULL;

UPDATE repositories repository
SET active_revision_id=NULL,active_projection_id=NULL,updated_at=now()
FROM repository_dossier_projections projection
JOIN repository_dossiers dossier ON dossier.id=projection.dossier_id
WHERE repository.active_projection_id=projection.id AND dossier.wiki_manifest IS NULL;
