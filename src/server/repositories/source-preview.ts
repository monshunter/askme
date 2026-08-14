import { createHash } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { AppError } from "@/server/errors";
import { extractPdfPagesFromBytes } from "@/server/materials/text-extraction";

import { readRepositoryArtifactEvidence, readRepositoryArtifactFiles, type RepositoryArtifactDescriptor } from "./artifact-reader";
import { citationContentHash } from "./dossier-output";

const sourceQuerySchema = z.object({
  messageId: z.string().uuid(),
  revisionId: z.string().uuid(),
  path: z.string().trim().min(1).max(1_024),
  lineStart: z.coerce.number().int().positive(),
  lineEnd: z.coerce.number().int().positive(),
}).strict().refine((value) => value.lineEnd >= value.lineStart && value.lineEnd - value.lineStart + 1 <= 200);

type SourceCitationRow = RepositoryArtifactDescriptor & {
  repositoryId: string;
  repositoryTitle: string;
  revisionId: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  contentHash: string;
  sourceContentHash: string | null;
  citationKind: "legacy" | "rag";
};

export function parseRepositorySourceQuery(url: URL) {
  const parsed = sourceQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw new AppError("INVALID_REPOSITORY_SOURCE_QUERY", "Send a valid immutable Repository source Citation.", 400);
  return parsed.data;
}

function sourceSlice(source: string, lineStart: number, lineEnd: number) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines.slice(lineStart - 1, lineEnd).join("\n");
}

export async function loadRepositorySourcePreview(input: {
  pool: Pool;
  artifactRoot: string;
  repositoryId: string;
  citation: z.infer<typeof sourceQuerySchema>;
  authorization:
    | { mode: "candidate"; ownerId: string }
    | { mode: "public"; ownerId: string; conversationId: string; publicationId: string };
}) {
  const values = [
    input.authorization.ownerId,
    input.repositoryId,
    input.citation.messageId,
    input.citation.revisionId,
    input.citation.path,
    input.citation.lineStart,
    input.citation.lineEnd,
  ];
  const authorizationSql = input.authorization.mode === "candidate"
    ? "repository.visibility IN ('agent_only','citation_allowed','public_preview')"
    : `repository.visibility='public_preview'
       AND conversation.id=$8 AND conversation.publication_id=$9 AND conversation.expires_at>now()
       AND publication.id=$9 AND publication.status='published' AND settings.public_mode=true AND owner.status='active'`;
  if (input.authorization.mode === "public") values.push(input.authorization.conversationId, input.authorization.publicationId);
  const result = await input.pool.query<SourceCitationRow>(
    `WITH source AS (
       SELECT citation.message_id,citation.owner_id,citation.repository_id,citation.revision_id,citation.path,
              citation.line_start,citation.line_end,citation.content_hash,NULL::text AS source_content_hash,'legacy'::text AS citation_kind
       FROM repository_message_citations citation
       UNION ALL
       SELECT citation.message_id,citation.owner_id,citation.source_id,(citation.metadata->>'revisionId')::uuid,citation.metadata->>'path',
              (citation.metadata#>>'{sourceRange,lineStart}')::integer,(citation.metadata#>>'{sourceRange,lineEnd}')::integer,
              NULL::text,citation.metadata->>'sourceContentHash','rag'::text
       FROM rag_message_citations citation
       JOIN rag_source_versions rag_source ON rag_source.id=citation.source_version_id AND rag_source.owner_id=citation.owner_id AND rag_source.state='active'
       JOIN rag_index_versions rag_version ON rag_version.id=citation.index_version_id AND rag_version.state='active'
       WHERE citation.source_kind IN ('repository_markdown','repository_pdf')
       UNION ALL
       SELECT citation.message_id,citation.owner_id,(rag_source.metadata->>'repositoryId')::uuid,(rag_source.metadata->>'revisionId')::uuid,
              source->>'path',(source->>'lineStart')::integer,(source->>'lineEnd')::integer,source->>'contentHash',NULL::text,'legacy'::text
       FROM rag_message_citations citation
       JOIN rag_source_versions rag_source ON rag_source.id=citation.source_version_id AND rag_source.owner_id=citation.owner_id AND rag_source.state='active'
       JOIN rag_index_versions rag_version ON rag_version.id=citation.index_version_id AND rag_version.state='active'
       CROSS JOIN LATERAL jsonb_array_elements(citation.metadata->'sourceCitations') source
       WHERE citation.source_kind='approved_wiki'
     )
     SELECT repository.id AS "repositoryId",repository.display_name AS "repositoryTitle",revision.id AS "revisionId",
            revision.commit_sha AS "commitSha",revision.filter_fingerprint AS "filterFingerprint",repository.canonical_url AS "canonicalUrl",
            artifact.content_key AS "contentKey",artifact.checksum,artifact.manifest_checksum AS "manifestChecksum",
            artifact.storage_path AS "storagePath",artifact.file_count AS "fileCount",
            source.path,source.line_start AS "lineStart",source.line_end AS "lineEnd",source.content_hash AS "contentHash",
            source.source_content_hash AS "sourceContentHash",source.citation_kind AS "citationKind"
     FROM source
     JOIN messages message ON message.id=source.message_id AND message.owner_id=source.owner_id
     JOIN conversations conversation ON conversation.id=message.conversation_id AND conversation.owner_id=message.owner_id
     JOIN repositories repository ON repository.id=source.repository_id AND repository.owner_id=source.owner_id AND repository.disabled_at IS NULL
     JOIN repository_revisions revision ON revision.id=source.revision_id AND revision.owner_id=source.owner_id
     JOIN repository_artifacts artifact ON artifact.content_key=revision.artifact_key
     LEFT JOIN publications publication ON publication.id=conversation.publication_id AND publication.owner_id=conversation.owner_id
     LEFT JOIN agent_settings settings ON settings.owner_id=conversation.owner_id
     LEFT JOIN users owner ON owner.id=conversation.owner_id
     WHERE source.owner_id=$1 AND source.repository_id=$2 AND source.message_id=$3 AND source.revision_id=$4
       AND source.path=$5 AND source.line_start=$6 AND source.line_end=$7 AND ${authorizationSql}
     LIMIT 1`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new AppError("REPOSITORY_SOURCE_NOT_FOUND", "The Repository source Citation is unavailable.", 404);
  let source: string | undefined;
  if (row.citationKind === "rag") {
    const artifact = await readRepositoryArtifactFiles(input.artifactRoot, row, [row.path]);
    const bytes = artifact.files.get(row.path);
    if (!bytes || !row.sourceContentHash || createHash("sha256").update(bytes).digest("hex") !== row.sourceContentHash) {
      throw new AppError("REPOSITORY_SOURCE_INTEGRITY_FAILED", "The immutable Repository source Citation failed validation.", 500);
    }
    if (row.path.toLocaleLowerCase().endsWith(".pdf")) {
      const pages = await extractPdfPagesFromBytes(bytes);
      source = pages.map((page) => `# Page ${page.pageNumber}\n\n${page.text}`).join("\n\n");
    } else {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    row.contentHash = citationContentHash(source, row.lineStart, row.lineEnd);
  } else {
    const evidence = await readRepositoryArtifactEvidence(input.artifactRoot, row, [row.path]);
    source = evidence.sources.get(row.path);
    if (source === undefined || citationContentHash(source, row.lineStart, row.lineEnd) !== row.contentHash) {
      throw new AppError("REPOSITORY_SOURCE_INTEGRITY_FAILED", "The immutable Repository source Citation failed validation.", 500);
    }
  }
  return {
    repository: { id: row.repositoryId, title: row.repositoryTitle },
    revision: { id: row.revisionId, commitSha: row.commitSha },
    path: row.path,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    contentHash: row.contentHash,
    content: sourceSlice(source, row.lineStart, row.lineEnd),
  };
}
