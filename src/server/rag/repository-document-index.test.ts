import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { invalidateRepositoryAnswers, reconcileRepositoryDocumentIndex, revokeRepositoryDocumentSources } from "./repository-document-index";

describe("Repository RAG revocation", () => {
  it.each([
    ["private", null],
    ["agent_only", "public"],
  ] as const)("persistently invalidates %s answers that cited the Repository", async (visibility, expectedMode) => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await invalidateRepositoryAnswers({ query } as never, "owner-id", "repository-id", visibility);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("source_invalidated_at=coalesce(message.source_invalidated_at,now())");
    expect(sql).toContain("repository_message_citations");
    expect(sql).toContain("rag_message_citations");
    expect(sql).toContain("JOIN rag_source_versions source ON source.id=citation.source_version_id");
    expect(sql).toContain("coalesce(source.metadata->>'repositoryId',citation.source_id::text)=$2::text");
    expect(query.mock.calls[0]?.[1]).toEqual(["owner-id", "repository-id", expectedMode]);
  });

  it("revokes current Repository source versions without deleting evidence", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await revokeRepositoryDocumentSources({ query } as never, "owner-id", "repository-id");

    expect(String(query.mock.calls[0]?.[0])).toContain("SET state='revoked'");
    expect(String(query.mock.calls[0]?.[0])).not.toMatch(/DELETE/i);
  });

  it("reports only Repository documents in Repository document readiness", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await reconcileRepositoryDocumentIndex({ query } as never, "owner-id", "repository-id", "commit-sha");

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql.match(/source\.source_kind IN \('repository_markdown','repository_pdf'\)/g)).toHaveLength(4);
  });

  it("keeps persistently invalidated answers and their Citations hidden after visibility is restored", () => {
    const repositoryService = readFileSync(path.resolve(process.cwd(), "src/server/repositories/repository-service.ts"), "utf8");
    const previewService = readFileSync(path.resolve(process.cwd(), "src/server/agent/preview-service.ts"), "utf8");
    const publicService = readFileSync(path.resolve(process.cwd(), "src/server/public-chat/public-chat-service.ts"), "utf8");

    expect(repositoryService).toContain("await invalidateRepositoryAnswers(client, ownerId, repositoryId, visibility)");
    expect(previewService).toContain("WHERE message.source_invalidated_at IS NULL");
    expect(publicService).toContain("WHERE message.source_invalidated_at IS NULL");
  });
});
