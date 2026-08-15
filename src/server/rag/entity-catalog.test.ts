import { describe, expect, it, vi } from "vitest";

import {
  detectAuthorizedEntityMentions,
  loadAuthorizedEntityCatalog,
  loadConversationEntityFocus,
  normalizeEntityAlias,
  resolveAuthorizedEntities,
  type AuthorizedEntityCatalog,
} from "./entity-catalog";

describe("normalizeEntityAlias", () => {
  it("matches stable case, width, whitespace, namespace and separator variants", () => {
    expect(normalizeEntityAlias(" Ｏｎｅ-Cat / API ")).toBe("onecatapi");
  });
});

describe("resolveAuthorizedEntities", () => {
  const catalog: AuthorizedEntityCatalog = {
    entities: [
      {
        key: "repository:onecat",
        type: "repository",
        canonicalName: "OneCat",
        aliases: ["OneCat", "owner/onecat"],
        materialIds: ["material-onecat"],
        repositoryIds: ["repository-onecat"],
      },
      {
        key: "project:askme",
        type: "project",
        canonicalName: "Askme",
        aliases: ["Askme"],
        materialIds: ["material-askme"],
        repositoryIds: [],
      },
    ],
    aliases: new Map([
      ["onecat", ["repository:onecat"]],
      ["owneronecat", ["repository:onecat"]],
      ["askme", ["project:askme"]],
    ]),
  };

  it("creates a hard source scope for uniquely resolved strict entities", () => {
    const result = resolveAuthorizedEntities([{ text: "one-cat", type: "project", source: "explicit" }], catalog);

    expect(result.stopBeforeRetrieval).toBe(false);
    expect(result.resolved).toHaveLength(1);
    expect(result.scope).toEqual({ materialIds: ["material-onecat"], repositoryIds: ["repository-onecat"] });
  });

  it("stops before retrieval when the only strict entity is missing", () => {
    const result = resolveAuthorizedEntities([{ text: "unknown-project", type: "project", source: "explicit" }], catalog);

    expect(result.stopBeforeRetrieval).toBe(true);
    expect(result.missing.map((mention) => mention.text)).toEqual(["unknown-project"]);
    expect(result.scope).toBeNull();
  });

  it("keeps technology mentions soft and never uses them as a hard source scope", () => {
    const result = resolveAuthorizedEntities([{ text: "RAG", type: "technology", source: "explicit" }], catalog);

    expect(result.soft).toHaveLength(1);
    expect(result.stopBeforeRetrieval).toBe(false);
    expect(result.scope).toBeNull();
  });

  it("stops an ambiguous conversational reference before retrieval", () => {
    const result = resolveAuthorizedEntities([], catalog, { status: "ambiguous", referenceText: "它" });

    expect(result.stopBeforeRetrieval).toBe(true);
    expect(result.gateReason).toBe("contextual_reference_ambiguous");
    expect(result.contextReference).toEqual({ status: "ambiguous", referenceText: "它" });
  });

  it("caps coverage at partial when an explicit entity resolves but a contextual reference remains ambiguous", () => {
    const result = resolveAuthorizedEntities(
      [{ text: "Askme", type: "project", source: "explicit" }],
      catalog,
      { status: "ambiguous", referenceText: "它" },
    );

    expect(result.stopBeforeRetrieval).toBe(false);
    expect(result.coverageCap).toBe("partial");
    expect(result.gateReason).toBe("resolved_with_ambiguous_context");
  });
});

describe("detectAuthorizedEntityMentions", () => {
  it("finds an authorized entity without relying on a type suffix or provider classification", () => {
    const catalog: AuthorizedEntityCatalog = {
      entities: [{ key: "project:askme", type: "project", canonicalName: "Askme", aliases: ["Askme"], materialIds: ["material-askme"], repositoryIds: [] }],
      aliases: new Map([["askme", ["project:askme"]]]),
    };

    expect(detectAuthorizedEntityMentions("Askme 怎么样？", catalog, "explicit")).toEqual([
      { text: "Askme", type: "project", source: "explicit" },
    ]);
  });

  it("keeps the longest alias span and does not invent a nested shorter identity", () => {
    const catalog: AuthorizedEntityCatalog = {
      entities: [
        { key: "repository:new-api", type: "repository", canonicalName: "new-api", aliases: ["new-api"], materialIds: [], repositoryIds: ["repository-new-api"] },
        { key: "product:api", type: "product", canonicalName: "API", aliases: ["API"], materialIds: ["material-api"], repositoryIds: [] },
      ],
      aliases: new Map([["newapi", ["repository:new-api"]], ["api", ["product:api"]]]),
    };

    expect(detectAuthorizedEntityMentions("new-api 怎么处理渠道？", catalog, "explicit")).toEqual([
      { text: "new-api", type: "repository", source: "explicit" },
    ]);
  });

  it("does not automatically scan one-character aliases", () => {
    const catalog: AuthorizedEntityCatalog = {
      entities: [{ key: "project:x", type: "project", canonicalName: "X", aliases: ["X"], materialIds: ["material-x"], repositoryIds: [] }],
      aliases: new Map([["x", ["project:x"]]]),
    };

    expect(detectAuthorizedEntityMentions("X 做了什么？", catalog, "explicit")).toEqual([]);
  });
});

describe("loadConversationEntityFocus", () => {
  it("loads only the most recent prior trace's safe resolved entity identities", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ resolved: [
      { text: "Askme", type: "project", canonicalName: "Askme" },
      { text: "new-api", type: "repository", canonicalName: "new-api" },
    ], missing: [], ambiguous: [] }] });

    const result = await loadConversationEntityFocus({ query } as never, "owner-id", "conversation-id");

    expect(result).toEqual({
      entities: [
        { canonicalName: "Askme", type: "project" },
        { canonicalName: "new-api", type: "repository" },
      ],
      status: "ambiguous",
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("rag_query_traces");
  });

  it("fails closed when a stored trace payload is malformed", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ resolved: [{ canonicalName: "Askme", type: "other" }], missing: [], ambiguous: [] }] });

    await expect(loadConversationEntityFocus({ query } as never, "owner-id", "conversation-id")).resolves.toEqual({ entities: [], status: "missing" });
  });

  it("keeps a resolved plus missing previous mention ambiguous for pronoun resolution", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      resolved: [{ canonicalName: "Askme", type: "project" }],
      missing: [{ text: "MoonBase", type: "project" }],
      ambiguous: [],
    }] });

    await expect(loadConversationEntityFocus({ query } as never, "owner-id", "conversation-id")).resolves.toEqual({
      entities: [{ canonicalName: "Askme", type: "project" }],
      status: "ambiguous",
    });
  });
});

describe("loadAuthorizedEntityCatalog", () => {
  it("filters both material and repository entities by the caller visibility projection", async () => {
    const query = vi.fn().mockImplementation((sql: string, values: unknown[]) => {
      expect(values[1]).toEqual(["citation_allowed", "public_preview"]);
      if (sql.includes("knowledge_items")) {
        return Promise.resolve({
          rows: [
            {
              materialId: "material-onecat",
              entities: [{ type: "project", canonicalName: "OneCat", aliases: ["one-cat"] }],
            },
          ],
        });
      }
      if (sql.includes("FROM repositories")) {
        return Promise.resolve({
          rows: [{ id: "repository-onecat", displayName: "OneCat", canonicalUrl: "https://github.com/owner/onecat.git" }],
        });
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await loadAuthorizedEntityCatalog({ query } as never, "owner-id", "public_answer");

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      key: "repository:repository-onecat",
      materialIds: ["material-onecat"],
      repositoryIds: ["repository-onecat"],
    });
  });
});
