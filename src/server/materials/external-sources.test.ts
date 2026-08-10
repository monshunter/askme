import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { createExternalSnapshot, type ExternalFetch } from "./external-sources";
import type { HostLookup } from "./remote-url";

const publicLookup: HostLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("external material snapshots", () => {
  it("follows only validated website redirects and extracts meaningful HTML text", async () => {
    const fetcher = vi.fn<ExternalFetch>(async (url) => {
      if (url === "https://example.com/start") {
        return new Response(null, { status: 302, headers: { location: "https://www.example.com/article" } });
      }
      return new Response(
        "<!doctype html><html><head><title>Career Notes</title><script>secret()</script></head><body><main><h1>Project Atlas</h1><p>Built a reliable system.</p></main></body></html>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });

    const snapshot = await createExternalSnapshot({ kind: "website", url: "https://example.com/start" }, { fetcher, lookup: publicLookup });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(snapshot).toMatchObject({ kind: "website", title: "Career Notes", externalUrl: "https://www.example.com/article" });
    expect(snapshot.content).toContain("Project Atlas");
    expect(snapshot.content).not.toContain("secret()");
  });

  it("maps a GitHub repository and README without retaining a supplied token", async () => {
    const token = "github-private-token-sentinel";
    const fetcher = vi.fn<ExternalFetch>(async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      if (url.endsWith("/readme")) {
        return new Response("# Askme\nA personal career knowledge base.", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return Response.json({
        full_name: "openai/askme",
        description: "Career knowledge base",
        html_url: "https://github.com/openai/askme",
        default_branch: "main",
        language: "TypeScript",
        topics: ["career"],
        visibility: "public",
      });
    });

    const snapshot = await createExternalSnapshot({ kind: "github", url: "https://github.com/openai/askme", token }, { fetcher, lookup: publicLookup });

    expect(snapshot.title).toBe("openai/askme");
    expect(snapshot.content).toContain("personal career knowledge base");
    expect(JSON.stringify(snapshot)).not.toContain(token);
    expect(snapshot.sourceMeta).toMatchObject({ repository: "openai/askme", defaultBranch: "main" });
  });

  it("requires a Notion token and recursively snapshots a page through the official API", async () => {
    const url = "https://www.notion.so/Career-Notes-11111111111141118111111111111111";
    await expect(createExternalSnapshot({ kind: "notion", url, targetType: "page" }, { fetcher: vi.fn(), lookup: publicLookup })).rejects.toMatchObject({
      code: "NOTION_TOKEN_REQUIRED",
    } satisfies Partial<AppError>);

    const token = "notion-token-sentinel";
    const fetcher = vi.fn<ExternalFetch>(async (requestUrl, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
      if (requestUrl.includes("/v1/pages/")) {
        return Response.json({
          object: "page",
          id: "11111111-1111-4111-8111-111111111111",
          url,
          properties: { title: { type: "title", title: [{ plain_text: "Career Notes" }] } },
        });
      }
      if (requestUrl.includes("22222222-2222-4222-8222-222222222222")) {
        return Response.json({ results: [{ id: "child", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Nested evidence" }] }, has_children: false }], has_more: false });
      }
      return Response.json({
        results: [
          { id: "first", type: "heading_1", heading_1: { rich_text: [{ plain_text: "Work History" }] }, has_children: false },
          { id: "22222222-2222-4222-8222-222222222222", type: "toggle", toggle: { rich_text: [{ plain_text: "Details" }] }, has_children: true },
        ],
        has_more: false,
      });
    });

    const snapshot = await createExternalSnapshot({ kind: "notion", url, targetType: "page", token }, { fetcher, lookup: publicLookup });

    expect(snapshot.title).toBe("Career Notes");
    expect(snapshot.content).toContain("Work History");
    expect(snapshot.content).toContain("Nested evidence");
    expect(JSON.stringify(snapshot)).not.toContain(token);
  });

  it("queries a Notion database through its current data source contract", async () => {
    const token = "notion-database-token";
    const databaseId = "33333333-3333-4333-8333-333333333333";
    const pageId = "44444444-4444-4444-8444-444444444444";
    const fetcher = vi.fn<ExternalFetch>(async (url) => {
      if (url.includes(`/v1/databases/${databaseId}`)) {
        return Response.json({ title: [{ plain_text: "Projects" }], data_sources: [{ id: "55555555-5555-4555-8555-555555555555", name: "Projects" }] });
      }
      if (url.includes("/v1/data_sources/") && url.endsWith("/query")) {
        return Response.json({ results: [{ id: pageId, properties: { Name: { type: "title", title: [{ plain_text: "Askme" }] } } }], has_more: false });
      }
      if (url.includes(`/v1/blocks/${pageId}/children`)) {
        return Response.json({ results: [{ id: "row", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Built with TypeScript" }] }, has_children: false }], has_more: false });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const snapshot = await createExternalSnapshot(
      { kind: "notion", url: `https://www.notion.so/${databaseId.replaceAll("-", "")}`, targetType: "database", token },
      { fetcher, lookup: publicLookup },
    );

    expect(snapshot.title).toBe("Projects");
    expect(snapshot.content).toContain("Askme");
    expect(snapshot.content).toContain("Built with TypeScript");
    expect(snapshot.sourceMeta).toMatchObject({ targetType: "database", databaseId });
  });
});
