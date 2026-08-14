import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["candidate", "admin"]);
export const accountStatus = pgEnum("account_status", ["active", "suspended"]);
export const materialKind = pgEnum("material_kind", ["file", "notion", "website"]);
export const materialStatus = pgEnum("material_status", ["queued", "processing", "indexed", "failed"]);
export const visibility = pgEnum("visibility", ["private", "agent_only", "citation_allowed", "public_preview"]);
export const jobStatus = pgEnum("job_status", ["queued", "processing", "completed", "failed"]);
export const knowledgeType = pgEnum("knowledge_type", [
  "project",
  "experience",
  "skill",
  "article",
  "repository",
  "summary",
]);
export const knowledgeStatus = pgEnum("knowledge_status", ["active", "archived"]);
export const publicationStatus = pgEnum("publication_status", ["draft", "published", "revoked", "paused"]);
export const conversationMode = pgEnum("conversation_mode", ["preview", "public"]);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", ["pending", "completed", "failed"]);
export const feedbackValue = pgEnum("feedback_value", ["up", "down"]);
export const flagSeverity = pgEnum("flag_severity", ["low", "medium", "high"]);
export const flagStatus = pgEnum("flag_status", ["open", "reviewing", "resolved", "dismissed"]);
export const adminInvitationStatus = pgEnum("admin_invitation_status", ["pending", "sent", "accepted", "failed", "revoked"]);
export const repositoryRevisionState = pgEnum("repository_revision_state", ["staging", "stored", "failed", "collected"]);
export const repositorySyncJobState = pgEnum("repository_sync_job_state", ["pending", "running", "completed", "failed", "cancelled"]);
export const repositoryDossierState = pgEnum("repository_dossier_state", ["generating", "review_pending", "failed", "disabled"]);
export const repositoryProjectionState = pgEnum("repository_projection_state", ["draft", "approved", "superseded", "disabled"]);
export const repositoryClaimCategory = pgEnum("repository_claim_category", [
  "overview",
  "implemented_behavior",
  "architecture",
  "api",
  "module",
  "data_security",
  "operations",
  "limitation",
]);
export const analysisRunPurpose = pgEnum("analysis_run_purpose", ["repository_analysis", "conversation_analysis"]);
export const analysisRunState = pgEnum("analysis_run_state", ["pending", "running", "completed", "failed", "cancelled"]);
export const analysisOutcome = pgEnum("analysis_outcome", ["answered", "insufficient", "refused"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    status: accountStatus("status").default("active").notNull(),
    locale: text("locale").default("en").notNull(),
    displayName: text("display_name").notNull(),
    headline: text("headline"),
    location: text("location"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash), index("sessions_user_idx").on(table.userId)],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_active_idx").on(table.userId, table.expiresAt),
  ],
);

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    kind: materialKind("kind").notNull(),
    title: text("title").notNull(),
    originalName: text("original_name"),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    storagePath: text("storage_path"),
    externalUrl: text("external_url"),
    sourceMeta: jsonb("source_meta").$type<Record<string, unknown>>().default({}).notNull(),
    status: materialStatus("status").default("queued").notNull(),
    visibility: visibility("visibility").default("private").notNull(),
    contentChecksum: text("content_checksum"),
    summary: text("summary"),
    processingVersion: integer("processing_version").default(1).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("materials_id_owner_unique").on(table.id, table.ownerId),
    index("materials_owner_status_idx").on(table.ownerId, table.status),
  ],
);

export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    status: jobStatus("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).defaultNow().notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("ingestion_jobs_material_unique").on(table.materialId), index("ingestion_jobs_due_idx").on(table.status, table.nextRunAt)],
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  version: text("version").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const analysisRunnerHeartbeats = pgTable("analysis_runner_heartbeats", {
  runnerId: text("runner_id").primaryKey(),
  version: text("version").notNull(),
  imageDigest: text("image_digest"),
  artifactReady: boolean("artifact_ready").default(false).notNull(),
  boxliteReady: boolean("boxlite_ready").default(false).notNull(),
  safeErrorCode: text("safe_error_code"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    tokenEstimate: integer("token_estimate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("chunks_material_position_unique").on(table.materialId, table.position), index("chunks_owner_idx").on(table.ownerId)],
);

export const knowledgeItems = pgTable(
  "knowledge_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    type: knowledgeType("type").notNull(),
    status: knowledgeStatus("status").default("active").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    highlights: jsonb("highlights").$type<string[]>().default([]).notNull(),
    confidence: real("confidence").default(0).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("knowledge_items_id_owner_unique").on(table.id, table.ownerId), index("knowledge_items_owner_type_idx").on(table.ownerId, table.type)],
);

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    knowledgeItemId: uuid("knowledge_item_id").references(() => knowledgeItems.id, { onDelete: "cascade" }).notNull(),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.knowledgeItemId, table.materialId] }), index("knowledge_sources_owner_idx").on(table.ownerId)],
);

export const knowledgeEvidence = pgTable(
  "knowledge_evidence",
  {
    knowledgeItemId: uuid("knowledge_item_id").notNull(),
    chunkId: uuid("chunk_id").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.knowledgeItemId, table.chunkId] }),
    foreignKey({ columns: [table.knowledgeItemId, table.ownerId], foreignColumns: [knowledgeItems.id, knowledgeItems.ownerId] }).onDelete("cascade"),
    foreignKey({ columns: [table.chunkId, table.ownerId], foreignColumns: [chunks.id, chunks.ownerId] }).onDelete("cascade"),
    index("knowledge_evidence_owner_idx").on(table.ownerId),
  ],
);

export const privacyConfirmations = pgTable("privacy_confirmations", {
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).primaryKey(),
  policyRevision: integer("policy_revision").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
});

export const privacyPolicyStates = pgTable("privacy_policy_states", {
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).primaryKey(),
  revision: integer("revision").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentSettings = pgTable("agent_settings", {
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).primaryKey(),
  answerTone: text("answer_tone").default("professional").notNull(),
  publicMode: boolean("public_mode").default(false).notNull(),
  privacySafeMode: boolean("privacy_safe_mode").default(true).notNull(),
  suggestedQuestions: jsonb("suggested_questions").$type<string[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    slug: text("slug").notNull(),
    status: publicationStatus("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pauseReason: text("pause_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("publications_slug_unique").on(table.slug),
    uniqueIndex("publications_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("publications_owner_active_unique").on(table.ownerId).where(sql`${table.status} in ('draft','published','paused')`),
    index("publications_owner_idx").on(table.ownerId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "cascade" }),
    mode: conversationMode("mode").notNull(),
    visitorTokenHash: text("visitor_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    suggestionCursor: integer("suggestion_cursor").default(0).notNull(),
    suggestedQuestions: jsonb("suggested_questions").$type<string[]>().default([]).notNull(),
    suggestionsContextHash: text("suggestions_context_hash"),
    suggestionsUpdatedAt: timestamp("suggestions_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversations_id_owner_unique").on(table.id, table.ownerId),
    index("conversations_public_visitor_sessions_idx").on(table.publicationId, table.visitorTokenHash, table.lastActivityAt, table.id).where(sql`${table.mode} = 'public'`),
    index("conversations_publication_idx").on(table.publicationId),
    index("conversations_public_expiry_idx").on(table.expiresAt).where(sql`${table.mode} = 'public'`),
  ],
);

export const publicRateLimits = pgTable(
  "public_rate_limits",
  {
    scopeKey: text("scope_key").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("public_rate_limits_updated_idx").on(table.updatedAt)],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  scopeKey: text("scope_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("auth_rate_limits_updated_idx").on(table.updatedAt)]);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: messageRole("role").notNull(),
    status: messageStatus("status").default("completed").notNull(),
    clientMessageId: text("client_message_id"),
    replyToMessageId: uuid("reply_to_message_id"),
    content: text("content").notNull(),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    sourceInvalidatedAt: timestamp("source_invalidated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("messages_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("messages_conversation_client_unique").on(table.conversationId, table.clientMessageId),
    uniqueIndex("messages_reply_unique").on(table.replyToMessageId),
    index("messages_conversation_idx").on(table.conversationId, table.createdAt),
  ],
);

export const messageCitations = pgTable(
  "message_citations",
  {
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
    chunkId: uuid("chunk_id").references(() => chunks.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    rank: integer("rank").notNull(),
    excerpt: text("excerpt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.chunkId] })],
);

export const answerFeedback = pgTable(
  "answer_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }).notNull(),
    actorKey: text("actor_key").notNull(),
    value: feedbackValue("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("answer_feedback_actor_unique").on(table.messageId, table.actorKey)],
);

export const contentFlags = pgTable(
  "content_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicationId: uuid("publication_id").references(() => publications.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    severity: flagSeverity("severity").notNull(),
    status: flagStatus("status").default("open").notNull(),
    safeSummary: text("safe_summary").notNull(),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("content_flags_status_idx").on(table.status, table.severity),
    uniqueIndex("content_flags_message_category_unique").on(table.messageId, table.category).where(sql`${table.messageId} is not null`),
    index("content_flags_created_idx").on(table.createdAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_actor_idx").on(table.actorId, table.createdAt), index("audit_events_target_idx").on(table.targetType, table.targetId)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_usage_created_idx").on(table.createdAt)],
);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const adminInvitations = pgTable(
  "admin_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: adminInvitationStatus("status").default("pending").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    errorCode: text("error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("admin_invitations_token_hash_unique").on(table.tokenHash),
    index("admin_invitations_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const repositoryArtifacts = pgTable(
  "repository_artifacts",
  {
    contentKey: text("content_key").primaryKey(),
    checksum: text("checksum").notNull(),
    manifestChecksum: text("manifest_checksum").notNull(),
    storagePath: text("storage_path").notNull(),
    compressedBytes: bigint("compressed_bytes", { mode: "number" }).notNull(),
    extractedBytes: bigint("extracted_bytes", { mode: "number" }).notNull(),
    fileCount: integer("file_count").notNull(),
    referenceCount: integer("reference_count").default(0).notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    gcEligibleAt: timestamp("gc_eligible_at", { withTimezone: true }),
    gcLeaseOwner: text("gc_lease_owner"),
    gcLeaseExpiresAt: timestamp("gc_lease_expires_at", { withTimezone: true }),
    gcErrorCode: text("gc_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("repository_artifacts_gc_idx").on(table.gcEligibleAt, table.gcLeaseExpiresAt)],
);

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    provider: text("provider").default("github").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    displayName: text("display_name").notNull(),
    visibility: visibility("visibility").default("private").notNull(),
    publicDeepAnalysisEnabled: boolean("public_deep_analysis_enabled").default(false).notNull(),
    activeRevisionId: uuid("active_revision_id"),
    activeProjectionId: uuid("active_projection_id"),
    analysisGeneration: integer("analysis_generation").default(0).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repositories_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("repositories_owner_url_unique").on(table.ownerId, table.canonicalUrl),
    index("repositories_owner_visibility_idx").on(table.ownerId, table.visibility),
  ],
);

export const repositoryRevisions = pgTable(
  "repository_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    requestedRef: text("requested_ref").notNull(),
    commitSha: text("commit_sha").notNull(),
    archiveChecksum: text("archive_checksum").notNull(),
    artifactKey: text("artifact_key").references(() => repositoryArtifacts.contentKey, { onDelete: "restrict" }),
    filterVersion: integer("filter_version").default(1).notNull(),
    filterFingerprint: text("filter_fingerprint").notNull(),
    excludePatterns: jsonb("exclude_patterns").$type<string[]>().default([]).notNull(),
    archiveBytes: bigint("archive_bytes", { mode: "number" }).notNull(),
    extractedBytes: bigint("extracted_bytes", { mode: "number" }).notNull(),
    fileCount: integer("file_count").notNull(),
    state: repositoryRevisionState("state").default("staging").notNull(),
    errorCode: text("error_code"),
    storedAt: timestamp("stored_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repository_revisions_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("repository_revisions_input_unique").on(table.repositoryId, table.commitSha, table.filterFingerprint),
    foreignKey({ columns: [table.repositoryId, table.ownerId], foreignColumns: [repositories.id, repositories.ownerId] }).onDelete("cascade"),
    index("repository_revisions_repository_created_idx").on(table.repositoryId, table.createdAt),
  ],
);

export const repositorySyncJobs = pgTable(
  "repository_sync_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: repositorySyncJobState("state").default("pending").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    safeErrorCode: text("safe_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repository_sync_jobs_idempotency_unique").on(table.idempotencyKey),
    foreignKey({ columns: [table.repositoryId, table.ownerId], foreignColumns: [repositories.id, repositories.ownerId] }).onDelete("cascade"),
    foreignKey({ columns: [table.revisionId, table.ownerId], foreignColumns: [repositoryRevisions.id, repositoryRevisions.ownerId] }).onDelete("cascade"),
    index("repository_sync_jobs_due_idx").on(table.state, table.createdAt),
  ],
);

export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    purpose: analysisRunPurpose("purpose").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
    assistantMessageId: uuid("assistant_message_id").references(() => messages.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    analysisGeneration: integer("analysis_generation").default(0).notNull(),
    state: analysisRunState("state").default("pending").notNull(),
    outcome: analysisOutcome("outcome"),
    priority: integer("priority").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    phase: text("phase").default("pending").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    budgetSnapshot: jsonb("budget_snapshot").$type<Record<string, number>>().default({}).notNull(),
    usage: jsonb("usage").$type<Record<string, number>>().default({}).notNull(),
    imageDigest: text("image_digest").notNull(),
    skillHash: text("skill_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    profileId: text("profile_id").notNull(),
    profileFingerprint: text("profile_fingerprint").notNull(),
    configuredModel: text("configured_model").notNull(),
    actualModel: text("actual_model"),
    microvmId: text("microvm_id"),
    safeErrorCode: text("safe_error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    cleanupCompletedAt: timestamp("cleanup_completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("analysis_runs_idempotency_unique").on(table.idempotencyKey),
    foreignKey({ columns: [table.repositoryId, table.ownerId], foreignColumns: [repositories.id, repositories.ownerId] }).onDelete("cascade"),
    foreignKey({ columns: [table.revisionId, table.ownerId], foreignColumns: [repositoryRevisions.id, repositoryRevisions.ownerId] }).onDelete("restrict"),
    index("analysis_runs_lease_idx").on(table.state, table.priority, table.leaseExpiresAt),
    index("analysis_runs_repository_idx").on(table.repositoryId, table.createdAt),
    index("analysis_runs_conversation_idx").on(table.conversationId, table.createdAt),
  ],
);

export const repositoryDossiers = pgTable(
  "repository_dossiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repositoryId: uuid("repository_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    analysisRunId: uuid("analysis_run_id").references(() => analysisRuns.id, { onDelete: "set null" }),
    generatedVersion: integer("generated_version").notNull(),
    analysisGeneration: integer("analysis_generation").notNull(),
    state: repositoryDossierState("state").default("generating").notNull(),
    wikiTitle: text("wiki_title"),
    wikiSummary: text("wiki_summary"),
    wikiManifest: jsonb("wiki_manifest").$type<Record<string, unknown> | null>(),
    coverage: jsonb("coverage").$type<Record<string, unknown>>().default({}).notNull(),
    imageDigest: text("image_digest").notNull(),
    skillHash: text("skill_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    profileFingerprint: text("profile_fingerprint").notNull(),
    configuredModel: text("configured_model").notNull(),
    actualModel: text("actual_model"),
    outdatedReason: text("outdated_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("repository_dossiers_id_owner_unique").on(table.id, table.ownerId),
    uniqueIndex("repository_dossiers_analysis_run_unique").on(table.analysisRunId),
    uniqueIndex("repository_dossiers_revision_version_unique").on(table.revisionId, table.generatedVersion),
    foreignKey({ columns: [table.repositoryId, table.ownerId], foreignColumns: [repositories.id, repositories.ownerId] }).onDelete("cascade"),
    foreignKey({ columns: [table.revisionId, table.ownerId], foreignColumns: [repositoryRevisions.id, repositoryRevisions.ownerId] }).onDelete("cascade"),
    index("repository_dossiers_review_idx").on(table.repositoryId, table.state, table.createdAt),
  ],
);

export const repositoryDossierClaims = pgTable(
  "repository_dossier_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dossierId: uuid("dossier_id").references(() => repositoryDossiers.id, { onDelete: "cascade" }).notNull(),
    category: repositoryClaimCategory("category").notNull(),
    title: text("title").notNull(),
    statementMarkdown: text("statement_markdown").notNull(),
    visibility: visibility("visibility").default("agent_only").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("repository_dossier_claims_order_unique").on(table.dossierId, table.sortOrder)],
);

export const repositoryDossierCitations = pgTable(
  "repository_dossier_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id").references(() => repositoryDossierClaims.id, { onDelete: "cascade" }).notNull(),
    revisionId: uuid("revision_id").references(() => repositoryRevisions.id, { onDelete: "restrict" }).notNull(),
    rank: integer("rank").notNull(),
    path: text("path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("repository_dossier_citations_rank_unique").on(table.claimId, table.rank)],
);

export const repositoryDossierProjections = pgTable(
  "repository_dossier_projections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dossierId: uuid("dossier_id").references(() => repositoryDossiers.id, { onDelete: "cascade" }).notNull(),
    state: repositoryProjectionState("state").default("draft").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("repository_dossier_projections_state_idx").on(table.dossierId, table.state),
    uniqueIndex("repository_dossier_projections_one_draft_idx").on(table.dossierId).where(sql`${table.state} = 'draft'`),
    uniqueIndex("repository_dossier_projections_id_dossier_unique").on(table.id, table.dossierId),
  ],
);

export const repositoryWikiPages = pgTable(
  "repository_wiki_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dossierId: uuid("dossier_id").references(() => repositoryDossiers.id, { onDelete: "cascade" }).notNull(),
    path: text("path").notNull(),
    title: text("title").notNull(),
    generatedMarkdown: text("generated_markdown").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("repository_wiki_pages_path_unique").on(table.dossierId, table.path),
    uniqueIndex("repository_wiki_pages_order_unique").on(table.dossierId, table.sortOrder),
    uniqueIndex("repository_wiki_pages_id_dossier_unique").on(table.id, table.dossierId),
  ],
);

export const repositoryWikiCitations = pgTable(
  "repository_wiki_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dossierId: uuid("dossier_id").references(() => repositoryDossiers.id, { onDelete: "cascade" }).notNull(),
    pageId: uuid("page_id").notNull(),
    revisionId: uuid("revision_id").references(() => repositoryRevisions.id, { onDelete: "restrict" }).notNull(),
    marker: text("marker").notNull(),
    rank: integer("rank").notNull(),
    path: text("path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.pageId, table.dossierId], foreignColumns: [repositoryWikiPages.id, repositoryWikiPages.dossierId] }).onDelete("cascade"),
    uniqueIndex("repository_wiki_citations_marker_unique").on(table.dossierId, table.marker),
    uniqueIndex("repository_wiki_citations_rank_unique").on(table.dossierId, table.rank),
    index("repository_wiki_citations_revision_idx").on(table.revisionId),
  ],
);

export const repositoryWikiProjectionPages = pgTable(
  "repository_wiki_projection_pages",
  {
    projectionId: uuid("projection_id").notNull(),
    pageId: uuid("page_id").notNull(),
    dossierId: uuid("dossier_id").references(() => repositoryDossiers.id, { onDelete: "cascade" }).notNull(),
    editedMarkdown: text("edited_markdown"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectionId, table.pageId] }),
    foreignKey({ columns: [table.projectionId, table.dossierId], foreignColumns: [repositoryDossierProjections.id, repositoryDossierProjections.dossierId] }).onDelete("cascade"),
    foreignKey({ columns: [table.pageId, table.dossierId], foreignColumns: [repositoryWikiPages.id, repositoryWikiPages.dossierId] }).onDelete("cascade"),
  ],
);

export const repositoryDossierProjectionClaims = pgTable(
  "repository_dossier_projection_claims",
  {
    projectionId: uuid("projection_id").references(() => repositoryDossierProjections.id, { onDelete: "cascade" }).notNull(),
    claimId: uuid("claim_id").references(() => repositoryDossierClaims.id, { onDelete: "cascade" }).notNull(),
    editedStatementMarkdown: text("edited_statement_markdown"),
    effectiveVisibility: visibility("effective_visibility").notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectionId, table.claimId] })],
);

export const repositoryMessageCitations = pgTable(
  "repository_message_citations",
  {
    messageId: uuid("message_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    rank: integer("rank").notNull(),
    path: text("path").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.rank] }),
    foreignKey({ columns: [table.messageId, table.ownerId], foreignColumns: [messages.id, messages.ownerId] }).onDelete("cascade"),
    foreignKey({ columns: [table.repositoryId, table.ownerId], foreignColumns: [repositories.id, repositories.ownerId] }).onDelete("cascade"),
    foreignKey({ columns: [table.revisionId, table.ownerId], foreignColumns: [repositoryRevisions.id, repositoryRevisions.ownerId] }).onDelete("restrict"),
  ],
);

export const analysisRunEvents = pgTable(
  "analysis_run_events",
  {
    runId: uuid("run_id").references(() => analysisRuns.id, { onDelete: "cascade" }).notNull(),
    version: integer("version").notNull(),
    state: analysisRunState("state").notNull(),
    phase: text("phase").notNull(),
    safeErrorCode: text("safe_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.version] })],
);

export const analysisQuotaUsage = pgTable(
  "analysis_quota_usage",
  {
    scopeType: text("scope_type").notNull(),
    scopeKey: text("scope_key").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    used: integer("used").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeType, table.scopeKey, table.windowStartedAt] }),
    index("analysis_quota_usage_window_idx").on(table.windowStartedAt),
  ],
);
