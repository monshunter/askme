import { describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "@/server/config";

import { retrieveRagForQuestion } from "./rag-query-service";

describe("retrieveRagForQuestion", () => {
  it("excludes time-range-outside evidence from answers and final Trace budget metrics", async () => {
    const outsideId = "11111111-1111-4111-8111-111111111111";
    const overlapId = "22222222-2222-4222-8222-222222222222";
    const row = (evidenceId: string, parentContent: string) => ({
      evidenceId,
      parentId: `parent-${evidenceId}`,
      stableKey: "a".repeat(64),
      sourceVersionId: "33333333-3333-4333-8333-333333333333",
      indexVersionId: "44444444-4444-4444-8444-444444444444",
      sourceKind: "material",
      sourceId: "55555555-5555-4555-8555-555555555555",
      repositoryId: null,
      sourceRevision: "revision",
      evidenceFamilyId: `family-${evidenceId}`,
      visibility: "citation_allowed",
      title: "Resume",
      path: null,
      commitSha: null,
      revisionId: null,
      sourceContentHash: null,
      structurePath: "Experience",
      content: parentContent,
      parentContent,
      tokenCount: 10,
      sourceRange: { lineStart: 1, lineEnd: 2 },
      contentChecksum: "f".repeat(64),
    });
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items") || sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag-route:exact")) return Promise.resolve({ rows: [
        row(outsideId, "2025年1月至2026年1月任职未来公司，负责平台治理"),
        row(overlapId, "2022年4月至2024年10月任职富途控股，担任云原生平台工程师"),
      ] });
      if (sql.includes("rag-route:")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const plannerComplete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        intent: "employment_history", subject: "profile_owner", queryMode: "discovery", knowledgeScope: "employment",
        standaloneQuery: "2022 到 2024 年的任职公司和职位", entityMentions: [],
        constraints: { timeRange: { start: "2022-01", end: "2024-12" } }, requestedFields: ["company", "job_title"],
        confidence: 0.95, ambiguities: [], mustTerms: ["任职"], shouldTerms: ["公司", "职位"],
        semanticQueries: ["2022 到 2024 年的任职公司和职位"], desiredEvidenceTypes: ["material"],
      }), inputTokens: 10, outputTokens: 10,
    });
    const answerabilityComplete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ aspects: [
        { aspectId: "a1", status: "supported", evidenceIds: [overlapId] },
        { aspectId: "a2", status: "supported", evidenceIds: [overlapId] },
      ] }), inputTokens: 5, outputTokens: 5,
    });
    const rerank = vi.fn().mockResolvedValue({ rankings: [{ index: 0, score: 0.9 }, { index: 1, score: 0.8 }], inputTokens: 2 });

    const result = await retrieveRagForQuestion({
      pool: { query } as never, config: getRuntimeConfig(), ownerId: "66666666-6666-4666-8666-666666666666",
      consumer: "candidate_preview", question: "2022年到2024年，你在哪家公司任职，担任什么职务？", currentDate: "2026-08-15",
    }, {
      plannerClient: { complete: plannerComplete },
      embeddingClient: { embed: vi.fn().mockResolvedValue({ vectors: [Array.from({ length: 1024 }, () => 0)], inputTokens: 1 }) },
      rerankClient: { rerank }, answerabilityClient: { complete: answerabilityComplete },
    });

    expect(result.candidates.map((item) => item.evidenceId)).toEqual([overlapId]);
    expect(result.temporalAnnotations).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceId: outsideId, status: "outside" }),
      expect.objectContaining({ evidenceId: overlapId, status: "overlap" }),
    ]));
    expect(result.independentFamilyCount).toBe(1);
    expect(result.actualTokens).toBeGreaterThanOrEqual(10);
    expect(answerabilityComplete.mock.calls[0]?.[0]?.[1]?.content).not.toContain(outsideId);
  });

  it("retrieves a self employment discovery question without inventing an organization entity", async () => {
    const materialId = "55555555-5555-4555-8555-555555555555";
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items")) return Promise.resolve({ rows: [{ materialId, entities: [{ type: "organization", canonicalName: "富途控股", aliases: [] }] }] });
      if (sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag-route:")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        intent: "employment_history",
        subject: "profile_owner",
        queryMode: "focused",
        knowledgeScope: "employment",
        standaloneQuery: "2022 到 2024 年的任职公司与职务",
        entityMentions: [{ text: "你在哪家", type: "organization", source: "explicit", role: "required" }],
        constraints: { timeRange: { start: "2022-01", end: "2024-12" } },
        requestedFields: ["company", "job_title", "responsibilities"],
        confidence: 0.99,
        ambiguities: [],
        mustTerms: [],
        shouldTerms: ["任职公司", "职务", "职责"],
        semanticQueries: ["2022 到 2024 年的任职公司与职务"],
        desiredEvidenceTypes: ["material", "knowledge"],
      }),
      inputTokens: 10,
      outputTokens: 10,
    });
    const embed = vi.fn().mockResolvedValue({ vectors: [Array.from({ length: 1024 }, () => 0)], inputTokens: 1 });

    const result = await retrieveRagForQuestion({
      pool: { query } as never,
      config: getRuntimeConfig(),
      ownerId: "44444444-4444-4444-8444-444444444444",
      consumer: "candidate_preview",
      question: "2022年到2024年，你在哪家公司任职，担任什么职务，负责什么工作内容？",
    }, { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } });

    expect(result.plan).toMatchObject({ subject: "profile_owner", queryMode: "discovery", knowledgeScope: "employment" });
    expect(result.plan.entityMentions).toEqual([]);
    expect(result.entityResolution.gateReason).toBe("no_required_entity");
    expect(result.roundCount).toBeGreaterThan(0);
    expect(query.mock.calls.some((call) => String(call[0]).includes("rag-route:"))).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("does not hard-scope an incidental authorized entity in a discovery question", async () => {
    const materialId = "55555555-5555-4555-8555-555555555555";
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("FROM knowledge_items")) return Promise.resolve({ rows: [{ materialId, entities: [{ type: "project", canonicalName: "Askme", aliases: [] }] }] });
      if (sql.includes("FROM repositories")) return Promise.resolve({ rows: [] });
      if (sql.includes("rag-route:")) return Promise.resolve({ rows: [] });
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        intent: "project_experience", subject: "profile_owner", queryMode: "discovery", knowledgeScope: "project",
        standaloneQuery: "候选人还做过哪些项目", entityMentions: [{ text: "Askme", type: "project", source: "explicit", role: "context" }],
        constraints: { timeRange: null }, requestedFields: ["project_name"], confidence: 0.95, ambiguities: [],
        mustTerms: [], shouldTerms: ["项目经历"], semanticQueries: ["候选人的其他项目经历"], desiredEvidenceTypes: ["material"],
      }), inputTokens: 10, outputTokens: 10,
    });
    const embed = vi.fn().mockResolvedValue({ vectors: [Array.from({ length: 1024 }, () => 0)], inputTokens: 1 });

    const result = await retrieveRagForQuestion({
      pool: { query } as never, config: getRuntimeConfig(), ownerId: "44444444-4444-4444-8444-444444444444",
      consumer: "candidate_preview", question: "看过 Askme 后，我还做过哪些项目？",
    }, { plannerClient: { complete }, embeddingClient: { embed }, rerankClient: { rerank: vi.fn() } });

    expect(result.plan.entityMentions).toContainEqual({ text: "Askme", type: "project", source: "explicit", role: "context" });
    expect(result.entityResolution.resolved).toEqual([]);
    expect(result.entityResolution.scope).toBeNull();
    expect(result.entityResolution.gateReason).toBe("no_required_entity");
  });

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
    expect(complete).toHaveBeenCalledTimes(2);
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
    expect(result.plan.entityMentions).toContainEqual({ text: "Askme", type: "project", source: "explicit", role: "required" });
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
    expect(result.plan.entityMentions).toContainEqual({ text: "Askme", type: "project", source: "contextual", role: "required" });
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
