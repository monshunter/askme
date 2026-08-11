import "server-only";

import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { allowedVisibilities } from "@/server/privacy/visibility-policy";

import { buildSuggestedQuestionsAtOffset, type SuggestionKnowledgeItem } from "../agent/suggested-questions";
import { parsePublicSlug } from "./publication-policy";

type PublicIdentity = {
  displayName: string;
  headline: string;
  location: string | null;
  bio: string | null;
  avatarUrl: string | null;
};

type PublicHighlight = {
  id: string;
  type: SuggestionKnowledgeItem["type"];
  title: string;
  summary: string;
  highlights: string[];
};

export type PublicationContext = {
  publicationId: string;
  ownerId: string;
  slug: string;
  status: "draft" | "published" | "revoked" | "paused";
  publishedAt: Date | null;
  updatedAt: Date;
};

async function publicSuggestionItems(ownerId: string) {
  const result = await getPool().query<SuggestionKnowledgeItem>(
    `SELECT knowledge.type,knowledge.title
     FROM knowledge_items knowledge
     WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND EXISTS (
       SELECT 1 FROM knowledge_evidence evidence
       JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
       JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
       WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
         AND material.status='indexed' AND material.visibility=ANY($2::visibility[])
     )
     ORDER BY knowledge.updated_at DESC,knowledge.id DESC LIMIT 12`,
    [ownerId, allowedVisibilities("public_answer")],
  );
  return result.rows;
}

export async function loadPublicSuggestedQuestions(ownerId: string, cursor: number) {
  return buildSuggestedQuestionsAtOffset(await publicSuggestionItems(ownerId), cursor);
}

async function projectPublicAgent(context: PublicationContext) {
  const pool = getPool();
  const [identityResult, statsResult, highlightsResult, suggestionItemsResult] = await Promise.all([
    pool.query<PublicIdentity>(
      `SELECT display_name AS "displayName",headline,location,bio,avatar_url AS "avatarUrl"
       FROM users WHERE id=$1 AND status='active'`,
      [context.ownerId],
    ),
    pool.query<{ publicKnowledgeItems: number; publicSources: number }>(
      `SELECT
         (SELECT count(DISTINCT knowledge.id)::int
          FROM knowledge_items knowledge
          WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND EXISTS (
            SELECT 1 FROM knowledge_evidence evidence
            JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
            JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
            WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
              AND material.status='indexed' AND material.visibility=ANY($2::visibility[])
          )) AS "publicKnowledgeItems",
         (SELECT count(*)::int FROM materials
          WHERE owner_id=$1 AND status='indexed' AND visibility=ANY($2::visibility[])) AS "publicSources"`,
      [context.ownerId, allowedVisibilities("public_answer")],
    ),
    pool.query<PublicHighlight>(
      `SELECT knowledge.id,knowledge.type,knowledge.title,knowledge.summary,knowledge.highlights
       FROM knowledge_items knowledge
       WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND EXISTS (
         SELECT 1 FROM knowledge_evidence evidence
         JOIN chunks chunk ON chunk.id=evidence.chunk_id AND chunk.owner_id=evidence.owner_id
         JOIN materials material ON material.id=chunk.material_id AND material.owner_id=chunk.owner_id
         WHERE evidence.knowledge_item_id=knowledge.id AND evidence.owner_id=knowledge.owner_id
           AND material.status='indexed' AND material.visibility='public_preview'
       )
       ORDER BY knowledge.confidence DESC,knowledge.updated_at DESC,knowledge.id DESC LIMIT 5`,
      [context.ownerId],
    ),
    publicSuggestionItems(context.ownerId),
  ]);
  const profile = identityResult.rows[0];
  if (!profile) throw new AppError("PUBLIC_AGENT_UNAVAILABLE", "This public Agent is unavailable.", 404);
  return {
    profile,
    agent: {
      slug: context.slug,
      status: context.status,
      publishedAt: context.publishedAt,
      updatedAt: context.updatedAt,
    },
    stats: statsResult.rows[0] ?? { publicKnowledgeItems: 0, publicSources: 0 },
    highlights: highlightsResult.rows.map((item) => ({ ...item, highlights: item.highlights.slice(0, 3) })),
    suggestedQuestions: buildSuggestedQuestionsAtOffset(suggestionItemsResult, 0),
  };
}

export async function loadPublicAgentBySlug(slugInput: string) {
  return projectPublicAgent(await requirePublicAgentContext(slugInput));
}

export async function requirePublicAgentContext(slugInput: string) {
  const slug = parsePublicSlug(slugInput);
  const publication = await getPool().query<PublicationContext>(
    `SELECT publication.id AS "publicationId",publication.owner_id AS "ownerId",publication.slug,publication.status,
            publication.published_at AS "publishedAt",publication.updated_at AS "updatedAt"
     FROM publications publication
     JOIN users user_account ON user_account.id=publication.owner_id AND user_account.status='active'
     JOIN agent_settings settings ON settings.owner_id=publication.owner_id AND settings.public_mode=true
     WHERE publication.slug=$1 AND publication.status='published' LIMIT 1`,
    [slug],
  );
  const context = publication.rows[0];
  if (!context) throw new AppError("PUBLIC_AGENT_UNAVAILABLE", "This public Agent is unavailable.", 404);
  return context;
}

export async function loadCandidatePublicPreview(ownerId: string) {
  const publication = await getPool().query<PublicationContext>(
    `SELECT id AS "publicationId",owner_id AS "ownerId",slug,status,published_at AS "publishedAt",updated_at AS "updatedAt"
     FROM publications WHERE owner_id=$1 AND status IN ('draft','published','paused')
     ORDER BY created_at DESC,id DESC LIMIT 1`,
    [ownerId],
  );
  const context = publication.rows[0];
  if (!context) throw new AppError("PUBLICATION_LINK_REQUIRED", "Generate a share link before opening the public preview.", 409);
  return projectPublicAgent(context);
}
