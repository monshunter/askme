import { createHash } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { allowedVisibilities, type VisibilityConsumer } from "@/server/privacy/visibility-policy";

export const entityMentionTypes = ["person", "organization", "project", "product", "repository", "technology", "other"] as const;
export type EntityMentionType = (typeof entityMentionTypes)[number];
export type EntityMention = { text: string; type: EntityMentionType; source: "explicit" | "contextual"; role: "required" | "context" };
const strictEntityTypes = ["person", "organization", "project", "product", "repository"] as const;
type StrictEntityType = (typeof strictEntityTypes)[number];
export type EntityScope = { materialIds: string[]; repositoryIds: string[] };
export type CatalogEntity = {
  key: string;
  type: Exclude<EntityMentionType, "other">;
  canonicalName: string;
  aliases: string[];
  materialIds: string[];
  repositoryIds: string[];
};
export type AuthorizedEntityCatalog = { entities: CatalogEntity[]; aliases: Map<string, string[]> };
export type ContextReferenceIssue = { status: "missing" | "ambiguous"; referenceText: string };
export type ConversationEntityFocus = { canonicalName: string; type: StrictEntityType };
export type ConversationEntityFocusState = { entities: ConversationEntityFocus[]; status: "unique" | "missing" | "ambiguous" };

const storedEntity = z.object({
  type: z.enum(entityMentionTypes.filter((type) => type !== "other") as [CatalogEntity["type"], ...CatalogEntity["type"][]]),
  canonicalName: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(12),
});

export function normalizeEntityAlias(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function repositoryEntityAliases(displayName: string, canonicalUrl: string) {
  let repositoryPath = canonicalUrl.trim().replace(/\.git$/iu, "").replace(/\/+$/u, "");
  try {
    repositoryPath = new URL(canonicalUrl).pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/iu, "");
  } catch {
    repositoryPath = repositoryPath.replace(/^[^:]+:/u, "").replace(/^\/+|\/+$/gu, "");
  }
  const parts = repositoryPath.split("/").filter(Boolean);
  return unique([displayName, parts.at(-1) ?? "", parts.slice(-2).join("/")]);
}

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function aliasSpan(text: string, alias: string) {
  const normalizedAlias = alias.normalize("NFKC").trim();
  const normalizedKey = normalizeEntityAlias(normalizedAlias);
  if (normalizedKey.length < 2) return null;
  const parts = normalizedAlias.split(/[\p{P}\p{S}\s]+/gu).filter(Boolean);
  if (parts.length === 0) return null;
  const body = parts.map(escapedPattern).join("[\\p{P}\\p{S}\\s]*");
  const match = new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, "iu").exec(text.normalize("NFKC"));
  return match ? { start: match.index, end: match.index + match[0].length, text: match[0] } : null;
}

export function detectAuthorizedEntityMentions(
  text: string,
  catalog: AuthorizedEntityCatalog,
  source: EntityMention["source"],
  role: NonNullable<EntityMention["role"]> = "context",
) {
  const byKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const aliases = new Map<string, string[]>();
  for (const entity of catalog.entities) {
    for (const alias of [entity.canonicalName, ...entity.aliases]) {
      const normalized = normalizeEntityAlias(alias);
      if (!normalized) continue;
      aliases.set(normalized, unique([...(aliases.get(normalized) ?? []), alias]));
    }
  }
  const candidates: Array<{ start: number; end: number; mention: EntityMention }> = [];
  for (const [normalized, values] of aliases) {
    const span = values.map((alias) => aliasSpan(text, alias)).find(Boolean);
    if (!span) continue;
    const keys = catalog.aliases.get(normalized) ?? [];
    const entity = keys.map((key) => byKey.get(key)).find((item): item is CatalogEntity => Boolean(item));
    if (!entity) continue;
    candidates.push({ start: span.start, end: span.end, mention: { text: span.text, type: entity.type, source, role } });
  }
  const selected: typeof candidates = [];
  for (const candidate of candidates.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start))) {
    if (selected.some((current) => current.start <= candidate.start && current.end >= candidate.end)) continue;
    selected.push(candidate);
  }
  return selected.map((candidate) => candidate.mention);
}

export async function loadConversationEntityFocus(
  pool: Pick<Pool, "query">,
  ownerId: string,
  conversationId: string,
): Promise<ConversationEntityFocusState> {
  const result = await pool.query<{ resolved: unknown; missing: unknown; ambiguous: unknown }>(
    `SELECT planner#>'{entityResolution,resolved}' AS resolved,
            planner#>'{entityResolution,missing}' AS missing,
            planner#>'{entityResolution,ambiguous}' AS ambiguous
     FROM rag_query_traces
     WHERE owner_id=$1 AND conversation_id=$2
     ORDER BY created_at DESC,id DESC
     LIMIT 1`,
    [ownerId, conversationId],
  );
  const focusSchema = z.object({
    canonicalName: z.string().trim().min(1).max(200),
    type: z.enum(strictEntityTypes),
  });
  const unresolvedSchema = z.object({
    text: z.string().trim().min(1).max(200),
    type: z.enum(strictEntityTypes),
  });
  const resolved = z.array(focusSchema).safeParse(result.rows[0]?.resolved);
  const missing = z.array(unresolvedSchema).safeParse(result.rows[0]?.missing);
  const ambiguous = z.array(unresolvedSchema).safeParse(result.rows[0]?.ambiguous);
  if (!resolved.success || !missing.success || !ambiguous.success) return { entities: [], status: "missing" };
  const focus = new Map<string, ConversationEntityFocus>();
  for (const item of resolved.data) focus.set(`${item.type}:${normalizeEntityAlias(item.canonicalName)}`, item);
  const entities = [...focus.values()];
  const mentionCount = entities.length + missing.data.length + ambiguous.data.length;
  return { entities, status: mentionCount === 1 && entities.length === 1 ? "unique" : mentionCount === 0 ? "missing" : "ambiguous" };
}

function addAliases(map: Map<string, Set<string>>, entity: CatalogEntity) {
  for (const alias of [entity.canonicalName, ...entity.aliases]) {
    const normalized = normalizeEntityAlias(alias);
    if (!normalized) continue;
    const keys = map.get(normalized) ?? new Set<string>();
    keys.add(entity.key);
    map.set(normalized, keys);
  }
}

export async function loadAuthorizedEntityCatalog(pool: Pick<Pool, "query">, ownerId: string, consumer: VisibilityConsumer): Promise<AuthorizedEntityCatalog> {
  const visibility = allowedVisibilities(consumer);
  const [materialResult, repositoryResult] = await Promise.all([
    pool.query<{ materialId: string; entities: unknown }>(
      `SELECT source.material_id AS "materialId",knowledge.entities
       FROM knowledge_items knowledge
       JOIN knowledge_sources source ON source.knowledge_item_id=knowledge.id AND source.owner_id=knowledge.owner_id
       JOIN materials material ON material.id=source.material_id AND material.owner_id=source.owner_id
       WHERE knowledge.owner_id=$1 AND knowledge.status='active' AND material.status='indexed'
         AND material.visibility=ANY($2::visibility[])`,
      [ownerId, visibility],
    ),
    pool.query<{ id: string; displayName: string; canonicalUrl: string }>(
      `SELECT id,display_name AS "displayName",canonical_url AS "canonicalUrl"
       FROM repositories
       WHERE owner_id=$1 AND disabled_at IS NULL AND visibility=ANY($2::visibility[])`,
      [ownerId, visibility],
    ),
  ]);

  const entities = new Map<string, CatalogEntity>();
  const repositoryAliasKeys = new Map<string, Set<string>>();
  for (const row of repositoryResult.rows) {
    const aliases = repositoryEntityAliases(row.displayName, row.canonicalUrl);
    const entity: CatalogEntity = {
      key: `repository:${row.id}`,
      type: "repository",
      canonicalName: row.displayName,
      aliases,
      materialIds: [],
      repositoryIds: [row.id],
    };
    entities.set(entity.key, entity);
    addAliases(repositoryAliasKeys, entity);
  }

  for (const row of materialResult.rows) {
    const parsed = z.array(storedEntity).safeParse(row.entities);
    if (!parsed.success) continue;
    for (const stored of parsed.data) {
      const names = unique([stored.canonicalName, ...stored.aliases]);
      const repositoryMatches = new Set(names.flatMap((name) => [...(repositoryAliasKeys.get(normalizeEntityAlias(name)) ?? [])]));
      const materialKey = `material:${createHash("sha256").update(`${stored.type}:${normalizeEntityAlias(stored.canonicalName)}`).digest("hex")}`;
      const key = (stored.type === "project" || stored.type === "repository") && repositoryMatches.size === 1 ? [...repositoryMatches][0]! : materialKey;
      const current = entities.get(key);
      if (current) {
        current.aliases = unique([...current.aliases, ...names]);
        current.materialIds = unique([...current.materialIds, row.materialId]);
      } else {
        entities.set(key, {
          key,
          type: stored.type,
          canonicalName: stored.canonicalName,
          aliases: names,
          materialIds: [row.materialId],
          repositoryIds: [],
        });
      }
    }
  }

  const aliasSets = new Map<string, Set<string>>();
  const ordered = [...entities.values()].sort((left, right) => left.key.localeCompare(right.key));
  for (const entity of ordered) addAliases(aliasSets, entity);
  return { entities: ordered, aliases: new Map([...aliasSets].map(([alias, keys]) => [alias, [...keys].sort()])) };
}

export type ResolvedEntity = { mention: EntityMention; entity: CatalogEntity };
export type EntityResolution = {
  mentions: EntityMention[];
  resolved: ResolvedEntity[];
  missing: EntityMention[];
  ambiguous: Array<{ mention: EntityMention; candidateCount: number }>;
  soft: EntityMention[];
  scope: EntityScope | null;
  contextReference: ContextReferenceIssue | null;
  stopBeforeRetrieval: boolean;
  coverageCap: "full" | "partial";
  gateReason: "no_required_entity" | "resolved" | "resolved_with_missing" | "strict_entity_missing" | "strict_entity_ambiguous"
    | "contextual_reference_missing" | "contextual_reference_ambiguous" | "resolved_with_missing_context" | "resolved_with_ambiguous_context"
    | "query_clarification_required";
};

export function resolveAuthorizedEntities(
  mentions: EntityMention[],
  catalog: AuthorizedEntityCatalog,
  contextReference: ContextReferenceIssue | null = null,
): EntityResolution {
  const byKey = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const resolved: ResolvedEntity[] = [];
  const missing: EntityMention[] = [];
  const ambiguous: EntityResolution["ambiguous"] = [];
  const soft: EntityMention[] = [];

  const requiredMentions = mentions.filter((mention) => mention.role === "required");
  soft.push(...mentions.filter((mention) => mention.role === "context"));
  for (const mention of requiredMentions) {
    if (mention.type === "technology" || mention.type === "other") {
      soft.push(mention);
      continue;
    }
    const matches = unique(catalog.aliases.get(normalizeEntityAlias(mention.text)) ?? []).map((key) => byKey.get(key)).filter((entity): entity is CatalogEntity => Boolean(entity));
    if (matches.length === 1) resolved.push({ mention, entity: matches[0]! });
    else if (matches.length === 0) missing.push(mention);
    else ambiguous.push({ mention, candidateCount: matches.length });
  }

  const strictCount = resolved.length + missing.length + ambiguous.length;
  const stopBeforeRetrieval = (strictCount > 0 || contextReference !== null) && resolved.length === 0;
  const materialIds = unique(resolved.flatMap((item) => item.entity.materialIds));
  const repositoryIds = unique(resolved.flatMap((item) => item.entity.repositoryIds));
  const scope = resolved.length > 0 ? { materialIds, repositoryIds } : null;
  const coverageCap = resolved.length > 0 && (missing.length > 0 || ambiguous.length > 0 || contextReference !== null) ? "partial" : "full";
  const gateReason = contextReference?.status === "ambiguous" && resolved.length === 0
    ? "contextual_reference_ambiguous"
    : contextReference?.status === "missing" && resolved.length === 0
      ? "contextual_reference_missing"
      : contextReference?.status === "ambiguous"
        ? "resolved_with_ambiguous_context"
        : contextReference?.status === "missing"
          ? "resolved_with_missing_context"
          : strictCount === 0
    ? "no_required_entity"
    : ambiguous.length > 0 && resolved.length === 0
      ? "strict_entity_ambiguous"
      : missing.length > 0 && resolved.length === 0
        ? "strict_entity_missing"
        : coverageCap === "partial"
          ? "resolved_with_missing"
          : "resolved";
  return { mentions, resolved, missing, ambiguous, soft, scope, contextReference, stopBeforeRetrieval, coverageCap, gateReason };
}

export function uniquelyResolvedRepositoryId(resolution: EntityResolution) {
  if (resolution.contextReference) return null;
  const repositoryIds = unique(resolution.resolved.flatMap((item) => item.entity.repositoryIds));
  return repositoryIds.length === 1 ? repositoryIds[0]! : null;
}
