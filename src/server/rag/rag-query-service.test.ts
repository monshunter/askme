import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { retrieveRagForQuestion } from "./rag-query-service";

describe("retrieveRagForQuestion", () => {
  it("stops unknown strict entities before embedding, rerank, or retrieval", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        standaloneQuery: "unknown-project 项目定位",
        entityMentions: [{ text: "unknown-project", type: "project", source: "explicit" }],
        mustTerms: ["unknown-project"],
        shouldTerms: ["定位"],
        semanticQueries: ["unknown-project 项目定位"],
        desiredEvidenceTypes: ["material"],
      }),
      inputTokens: 10,
      outputTokens: 10,
    });
    const embed = vi.fn();
    const rerank = vi.fn();

    const result = await retrieveRagForQuestion(
      {
        pool: { query } as never,
        config: getRuntimeConfig(),
        ownerId: "44444444-4444-4444-8444-444444444444",
        consumer: "candidate_preview",
        question: "unknown-project 项目的定位是什么？",
      },
      { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank } },
    );

    expect(result.coverage).toBe("none");
    expect(result.roundCount).toBe(0);
    expect(result.entityResolution.gateReason).toBe("strict_entity_missing");
    expect(embed).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
    expect(query.mock.calls.some((call) => String(call[0]).includes("rag-route:"))).toBe(false);
  });

  it("fails closed for an untyped unknown CamelCase identity when the planner falls back", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const complete = vi.fn().mockResolvedValue({ content: '{"invalid":true}', inputTokens: 1, outputTokens: 1 });
    const embed = vi.fn();

    const result = await retrieveRagForQuestion(
      {
        pool: { query } as never,
        config: getRuntimeConfig(),
        ownerId: "44444444-4444-4444-8444-444444444444",
        consumer: "candidate_preview",
        question: "MoonBase 怎么样？",
      },
      { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } },
    );

    expect(result.coverage).toBe("none");
    expect(result.entityResolution.gateReason).toBe("strict_entity_missing");
    expect(result.plan.degradations).toContain("planner_fallback");
    expect(embed).not.toHaveBeenCalled();
  });

  it("hard-scopes an untyped explicit alias found directly in the authorized catalog", async () => {
    const materialId = "55555555-5555-4555-8555-555555555555";
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items")) return Promise.resolve({ rows: [{ materialId, entities: [{ type: "project", canonicalName: "Askme", aliases: [] }] }] });
      if (sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag-route:")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        standaloneQuery: "Askme 怎么样",
        entityMentions: [],
        mustTerms: [],
        shouldTerms: ["Askme"],
        semanticQueries: ["Askme 怎么样"],
        desiredEvidenceTypes: ["material"],
      }),
      inputTokens: 10,
      outputTokens: 10,
    });
    const embed = vi.fn().mockResolvedValue({ vectors: [Array.from({ length: 1024 }, () => 0)], inputTokens: 1 });

    const result = await retrieveRagForQuestion(
      {
        pool: { query } as never,
        config: getRuntimeConfig(),
        ownerId: "44444444-4444-4444-8444-444444444444",
        consumer: "candidate_preview",
        question: "Askme 怎么样？",
      },
      { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } },
    );

    expect(result.entityResolution.resolved[0]?.entity.canonicalName).toBe("Askme");
    expect(result.entityResolution.scope).toEqual({ materialIds: [materialId], repositoryIds: [] });
    expect(result.plan.entityMentions).toContainEqual({ text: "Askme", type: "project", source: "explicit" });
    const routeCalls = query.mock.calls.filter((call) => String(call[0]).includes("rag-route:"));
    expect(routeCalls.length).toBeGreaterThan(0);
    expect(routeCalls.every((call) => call[1]?.[2]?.[0] === materialId)).toBe(true);
  });

  it("uses the latest traced entity focus instead of a planner contextual guess", async () => {
    const askmeMaterialId = "55555555-5555-4555-8555-555555555555";
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items")) return Promise.resolve({ rows: [
        { materialId: askmeMaterialId, entities: [{ type: "project", canonicalName: "Askme", aliases: [] }] },
        { materialId: "66666666-6666-4666-8666-666666666666", entities: [{ type: "project", canonicalName: "OneCat", aliases: [] }] },
      ] });
      if (sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag_query_traces")) return Promise.resolve({ rows: [{ resolved: [{ canonicalName: "Askme", type: "project" }], missing: [], ambiguous: [] }] });
      if (sql.includes("rag-route:")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        standaloneQuery: "OneCat 解决的问题",
        entityMentions: [{ text: "OneCat", type: "project", source: "contextual" }],
        mustTerms: [], shouldTerms: ["解决"], semanticQueries: ["OneCat 解决的问题"], desiredEvidenceTypes: ["material"],
      }), inputTokens: 10, outputTokens: 10,
    });
    const embed = vi.fn().mockResolvedValue({ vectors: [Array.from({ length: 1024 }, () => 0)], inputTokens: 1 });

    const result = await retrieveRagForQuestion(
      {
        pool: { query } as never, config: getRuntimeConfig(), ownerId: "44444444-4444-4444-8444-444444444444",
        consumer: "candidate_preview", question: "它解决了什么问题？", conversationId: "77777777-7777-4777-8777-777777777777",
      },
      { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } },
    );

    expect(result.entityResolution.resolved.map((item) => item.entity.canonicalName)).toEqual(["Askme"]);
    expect(result.entityResolution.scope).toEqual({ materialIds: [askmeMaterialId], repositoryIds: [] });
    expect(result.plan.entityMentions).toContainEqual({ text: "Askme", type: "project", source: "contextual" });
    expect(result.plan.entityMentions.some((mention) => mention.text === "OneCat")).toBe(false);
    expect(result.plan.standaloneQuery).toContain("Askme");
    expect(result.plan.semanticQueries.every((queryText) => queryText.includes("Askme"))).toBe(true);
  });

  it("fails closed before embedding when the previous trace has multiple entity focuses", async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items")) return Promise.resolve({ rows: [
        { materialId: "55555555-5555-4555-8555-555555555555", entities: [{ type: "project", canonicalName: "Askme", aliases: [] }] },
        { materialId: "66666666-6666-4666-8666-666666666666", entities: [{ type: "project", canonicalName: "OneCat", aliases: [] }] },
      ] });
      if (sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag_query_traces")) return Promise.resolve({ rows: [{ resolved: [
        { canonicalName: "Askme", type: "project" },
        { canonicalName: "OneCat", type: "project" },
      ], missing: [], ambiguous: [] }] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        standaloneQuery: "Askme 解决的问题", entityMentions: [{ text: "Askme", type: "project", source: "contextual" }],
        mustTerms: [], shouldTerms: ["解决"], semanticQueries: ["Askme 解决的问题"], desiredEvidenceTypes: ["material"],
      }), inputTokens: 10, outputTokens: 10,
    });
    const embed = vi.fn();

    const result = await retrieveRagForQuestion(
      {
        pool: { query } as never, config: getRuntimeConfig(), ownerId: "44444444-4444-4444-8444-444444444444",
        consumer: "candidate_preview", question: "它解决了什么问题？", conversationId: "77777777-7777-4777-8777-777777777777",
      },
      { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } },
    );

    expect(result.coverage).toBe("none");
    expect(result.roundCount).toBe(0);
    expect(result.entityResolution.gateReason).toBe("contextual_reference_ambiguous");
    expect(embed).not.toHaveBeenCalled();
    expect(query.mock.calls.some((call) => String(call[0]).includes("rag-route:"))).toBe(false);
  });

  it("keeps a previous resolved plus missing entity ambiguous instead of attaching the pronoun to the resolved one", async () => {
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items")) return Promise.resolve({ rows: [{
        materialId: "55555555-5555-4555-8555-555555555555", entities: [{ type: "project", canonicalName: "Askme", aliases: [] }],
      }] });
      if (sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag_query_traces")) return Promise.resolve({ rows: [{
        resolved: [{ canonicalName: "Askme", type: "project" }],
        missing: [{ text: "MoonBase", type: "project" }],
        ambiguous: [],
      }] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ standaloneQuery: "Askme 解决的问题", entityMentions: [{ text: "Askme", type: "project", source: "contextual" }], mustTerms: [], shouldTerms: ["解决"], semanticQueries: ["Askme 解决的问题"], desiredEvidenceTypes: ["material"] }),
      inputTokens: 10, outputTokens: 10,
    });
    const embed = vi.fn();

    const result = await retrieveRagForQuestion(
      {
        pool: { query } as never, config: getRuntimeConfig(), ownerId: "44444444-4444-4444-8444-444444444444",
        consumer: "candidate_preview", question: "它解决了什么问题？", conversationId: "77777777-7777-4777-8777-777777777777",
      },
      { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } },
    );

    expect(result.entityResolution.gateReason).toBe("contextual_reference_ambiguous");
    expect(result.entityResolution.resolved).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});
