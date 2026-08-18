import type { Pool } from "pg";

import type { RuntimeConfig } from "@/server/config";
import { allowedVisibilities, type MaterialVisibility, type VisibilityConsumer } from "@/server/privacy/visibility-policy";

import type { RetrievedRagEvidence } from "./hybrid-retriever";

type AnchoredProfileRow = {
  evidenceId: string;
  parentId: string;
  stableKey: string;
  sourceVersionId: string;
  indexVersionId: string;
  sourceKind: "material";
  sourceId: string;
  repositoryId: string | null;
  sourceRevision: string;
  evidenceFamilyId: string;
  visibility: MaterialVisibility;
  title: string;
  path: string | null;
  commitSha: string | null;
  revisionId: string | null;
  sourceContentHash: string | null;
  structurePath: string;
  content: string;
  parentContent: string;
  tokenCount: number;
  sourceRange: { lineStart?: number; lineEnd?: number };
  contentChecksum: string;
};

// The owner-pinned profile document (agent_settings.profile_material_id) is the candidate's
// authoritative career identity. Overview questions (自我介绍 / introduce yourself) rarely
// share literal terms with it, so retrieval can miss it entirely. Instead of retrieving it,
// load its indexed chunks deterministically and anchor them as the first evidence items for
// every question; the answerability gate and citation validation still treat them as
// ordinary untrusted material evidence. The document is re-validated against the same
// eligibility rules as the pin itself (indexed file material, visibility allowed for the
// consumer), so a revoked or re-uploaded profile simply yields no anchored evidence.
export async function loadAnchoredProfileEvidence(
  pool: Pool,
  ownerId: string,
  consumer: VisibilityConsumer,
  config: RuntimeConfig,
): Promise<RetrievedRagEvidence[]> {
  const result = await pool.query<AnchoredProfileRow>(
    `SELECT child.id AS "evidenceId",child.parent_id AS "parentId",child.stable_key AS "stableKey",
            source.id AS "sourceVersionId",source.index_version_id AS "indexVersionId",source.source_kind AS "sourceKind",
            source.source_id AS "sourceId",source.metadata->>'repositoryId' AS "repositoryId",source.source_revision AS "sourceRevision",
            source.evidence_family_id AS "evidenceFamilyId",material.visibility,material.title,
            source.metadata->>'path' AS path,source.metadata->>'commitSha' AS "commitSha",source.metadata->>'revisionId' AS "revisionId",
            source.metadata->>'contentHash' AS "sourceContentHash",
            parent.structure_path AS "structurePath",child.content,parent.content AS "parentContent",
            parent.token_count AS "tokenCount",parent.source_range AS "sourceRange",child.content_checksum AS "contentChecksum"
     FROM agent_settings settings
     JOIN rag_child_chunks child ON child.owner_id=settings.owner_id
     JOIN rag_parent_chunks parent ON parent.id=child.parent_id AND parent.owner_id=child.owner_id
       AND parent.index_version_id=child.index_version_id AND parent.source_version_id=child.source_version_id
     JOIN rag_source_versions source ON source.id=child.source_version_id AND source.owner_id=child.owner_id
       AND source.index_version_id=child.index_version_id AND source.state='active'
     JOIN rag_index_versions version ON version.id=child.index_version_id AND version.state='active'
     JOIN materials material ON material.id=source.source_id AND material.owner_id=source.owner_id
     WHERE settings.owner_id=$1 AND settings.profile_material_id IS NOT NULL
       AND source.source_kind='material' AND source.source_id=settings.profile_material_id
       AND material.status='indexed' AND material.content_checksum=source.source_revision
       AND material.visibility=ANY($2::visibility[])
     ORDER BY parent.position ASC,child.position ASC`,
    [ownerId, allowedVisibilities(consumer)],
  );
  const maxChars = config.rag.evidence.profileMaxChars;
  const anchored: RetrievedRagEvidence[] = [];
  const seenParents = new Set<string>();
  let usedChars = 0;
  for (const row of result.rows) {
    // One representative child per parent: every child of a parent renders the same
    // parentContent, so siblings would duplicate content in the packet.
    if (seenParents.has(row.parentId)) continue;
    seenParents.add(row.parentId);
    const chars = row.parentContent.length;
    // Always include the first chunk even when it exceeds the allowance, so a profile
    // stored as one large parent still anchors; later chunks must fit inside the cap.
    if (anchored.length > 0 && usedChars + chars > maxChars) break;
    usedChars += chars;
    anchored.push({
      ...row,
      score: 1,
      rrfScore: 0,
      routeRanks: {},
    });
  }
  return anchored;
}
