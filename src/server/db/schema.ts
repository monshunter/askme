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

export const userRole = pgEnum("user_role", ["candidate", "admin"]);
export const accountStatus = pgEnum("account_status", ["active", "suspended"]);
export const materialKind = pgEnum("material_kind", ["file", "github", "notion", "website"]);
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
  (table) => [uniqueIndex("publications_slug_unique").on(table.slug), uniqueIndex("publications_id_owner_unique").on(table.id, table.ownerId), index("publications_owner_idx").on(table.ownerId)],
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("conversations_id_owner_unique").on(table.id, table.ownerId), index("conversations_publication_idx").on(table.publicationId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }).notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    role: messageRole("role").notNull(),
    status: messageStatus("status").default("completed").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("messages_id_owner_unique").on(table.id, table.ownerId), index("messages_conversation_idx").on(table.conversationId, table.createdAt)],
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
  (table) => [index("content_flags_status_idx").on(table.status, table.severity)],
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
