import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  adminInvitations,
  analysisRunEvents,
  analysisRuns,
  contentFlags,
  conversations,
  authRateLimits,
  materials,
  messages,
  passwordResetTokens,
  repositories,
  repositoryArtifacts,
  repositoryDossierCitations,
  repositoryDossierClaims,
  repositoryDossierProjectionClaims,
  repositoryDossierProjections,
  repositoryDossiers,
  repositoryWikiCitations,
  repositoryWikiPages,
  repositoryWikiProjectionPages,
  repositoryMessageCitations,
  repositoryRevisions,
  repositorySyncJobs,
  ragChildChunks,
  ragIndexVersions,
  ragParentChunks,
  ragSourceVersions,
} from "./schema";

describe("database schema alignment", () => {
  it("persists only hashed one-time password reset and auth rate-limit state", () => {
    const resetColumns = getTableColumns(passwordResetTokens);
    expect(resetColumns.tokenHash?.name).toBe("token_hash");
    expect(resetColumns.expiresAt?.name).toBe("expires_at");
    expect(resetColumns.usedAt?.name).toBe("used_at");
    expect(resetColumns).not.toHaveProperty("token");
    expect(getTableColumns(authRateLimits).scopeKey?.name).toBe("scope_key");
  });

  it("owns answer source invalidation on messages rather than materials", () => {
    expect(getTableColumns(materials)).not.toHaveProperty("sourceInvalidatedAt");
    expect(getTableColumns(messages).sourceInvalidatedAt?.name).toBe("source_invalidated_at");
  });

  it("exposes the persistent Admin invitation and review state owners", () => {
    const invitationColumns = getTableColumns(adminInvitations);
    expect(invitationColumns.tokenHash?.name).toBe("token_hash");
    expect(invitationColumns.status?.name).toBe("status");
    expect(invitationColumns.invitedBy?.name).toBe("invited_by");
    expect(invitationColumns.expiresAt?.name).toBe("expires_at");

    const flagColumns = getTableColumns(contentFlags);
    expect(flagColumns.safeSummary?.name).toBe("safe_summary");
    expect(flagColumns.reviewedBy?.name).toBe("reviewed_by");
    expect(flagColumns.reviewedAt?.name).toBe("reviewed_at");
  });

  it("separates Repository revisions, immutable artifacts, generated Wikis and approved projections", () => {
    expect(getTableColumns(repositories).activeRevisionId?.name).toBe("active_revision_id");
    expect(getTableColumns(repositories).activeProjectionId?.name).toBe("active_projection_id");
    expect(getTableColumns(repositories).ragIndexState?.name).toBe("rag_index_state");
    expect(getTableColumns(repositories).ragIndexCommitSha?.name).toBe("rag_index_commit_sha");
    expect(getTableColumns(repositories).ragIndexWarnings?.name).toBe("rag_index_warnings");
    expect(getTableColumns(repositoryRevisions).commitSha?.name).toBe("commit_sha");
    expect(getTableColumns(repositoryRevisions).artifactKey?.name).toBe("artifact_key");
    expect(getTableColumns(repositoryArtifacts).contentKey?.name).toBe("content_key");
    expect(getTableColumns(repositorySyncJobs).idempotencyKey?.name).toBe("idempotency_key");
    expect(getTableColumns(repositoryDossiers).coverage?.name).toBe("coverage");
    expect(getTableColumns(repositoryDossiers).wikiManifest?.name).toBe("wiki_manifest");
    expect(getTableColumns(repositoryWikiPages).generatedMarkdown?.name).toBe("generated_markdown");
    expect(getTableColumns(repositoryWikiCitations).marker?.name).toBe("marker");
    expect(getTableColumns(repositoryWikiCitations).contentHash?.name).toBe("content_hash");
    expect(getTableColumns(repositoryWikiProjectionPages).editedMarkdown?.name).toBe("edited_markdown");
    // Legacy Claim-only tables remain data-preserving but are no longer current consumers.
    expect(getTableColumns(repositoryDossierClaims).statementMarkdown?.name).toBe("statement_markdown");
    expect(getTableColumns(repositoryDossierCitations).contentHash?.name).toBe("content_hash");
    expect(getTableColumns(repositoryDossierProjections).approvedAt?.name).toBe("approved_at");
    expect(getTableColumns(repositoryDossierProjectionClaims).editedStatementMarkdown?.name).toBe("edited_statement_markdown");
  });

  it("persists minimal run and source-Citation state without credential or reasoning fields", () => {
    const runColumns = getTableColumns(analysisRuns);
    expect(runColumns.purpose?.name).toBe("purpose");
    expect(runColumns.version?.name).toBe("version");
    expect(runColumns.budgetSnapshot?.name).toBe("budget_snapshot");
    expect(runColumns.usage?.name).toBe("usage");
    expect(runColumns.configuredModel?.name).toBe("configured_model");
    expect(runColumns.cleanupCompletedAt?.name).toBe("cleanup_completed_at");
    expect(runColumns).not.toHaveProperty("githubToken");
    expect(runColumns).not.toHaveProperty("apiKey");
    expect(runColumns).not.toHaveProperty("reasoning");
    expect(runColumns).not.toHaveProperty("toolOutput");
    expect(getTableColumns(analysisRunEvents).version?.name).toBe("version");
    expect(getTableColumns(repositoryMessageCitations).contentHash?.name).toBe("content_hash");
  });

  it("owns suggested questions and their context version on each Conversation", () => {
    const columns = getTableColumns(conversations);
    expect(columns.suggestedQuestions?.name).toBe("suggested_questions");
    expect(columns.suggestionsContextHash?.name).toBe("suggestions_context_hash");
    expect(columns.suggestionsUpdatedAt?.name).toBe("suggestions_updated_at");
  });

  it("owns Hybrid RAG index, source, Parent and Child lifecycle state explicitly", () => {
    const indexColumns = getTableColumns(ragIndexVersions);
    expect(indexColumns.state?.name).toBe("state");
    expect(indexColumns.configFingerprint?.name).toBe("config_fingerprint");
    expect(indexColumns.embeddingDimensions?.name).toBe("embedding_dimensions");
    expect(indexColumns.expectedSourceCount?.name).toBe("expected_source_count");

    const sourceColumns = getTableColumns(ragSourceVersions);
    expect(sourceColumns.sourceRevision?.name).toBe("source_revision");
    expect(sourceColumns.evidenceFamilyId?.name).toBe("evidence_family_id");
    expect(sourceColumns.leaseOwner?.name).toBe("lease_owner");
    expect(sourceColumns.metadata?.name).toBe("metadata");

    expect(getTableColumns(ragParentChunks).structurePath?.name).toBe("structure_path");
    expect(getTableColumns(ragParentChunks).sourceRange?.name).toBe("source_range");
    expect(getTableColumns(ragChildChunks).contextualContent?.name).toBe("contextual_content");
    expect(getTableColumns(ragChildChunks).embedding?.name).toBe("embedding");
  });
});
