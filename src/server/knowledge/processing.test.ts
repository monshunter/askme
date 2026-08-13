import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

import { chunkMaterialText, organizationContext } from "./chunking";
import { organizeMaterialKnowledge, parseKnowledgeOrganization, type OrganizationClient } from "./organizer";

describe("knowledge organization", () => {
  it("creates deterministic bounded chunks with overlap and token estimates", () => {
    const text = Array.from({ length: 80 }, (_, index) => `Paragraph ${index}. Candidate evidence for a reliable project.`).join("\n\n");
    const first = chunkMaterialText(text, 500, 60);
    const second = chunkMaterialText(text, 500, 60);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(2);
    expect(first.every((chunk, index) => chunk.position === index && chunk.content.length <= 500 && chunk.tokenEstimate > 0)).toBe(true);
    expect(first[0]!.content).toContain(first[1]!.content.slice(0, 30));
  });

  it("samples long evidence across the full source without exceeding the prompt budget", () => {
    const chunks = chunkMaterialText(Array.from({ length: 100 }, (_, index) => `Evidence-${index} ${"x".repeat(100)}`).join("\n\n"), 500, 40);
    const context = organizationContext(chunks, 2_000);
    expect(context.length).toBeLessThanOrEqual(2_000);
    expect(context).toContain("[Evidence chunk 0]");
    expect(context).toContain("Evidence-0");
    expect(context).toContain("Evidence-99");
  });

  it("validates the AI JSON contract and requests OpenAI-compatible JSON mode", async () => {
    const payload = {
      materialSummary: "A grounded project summary.",
      items: [{ type: "project", title: "Askme", summary: "A candidate career knowledge base.", highlights: ["Owner-isolated evidence"], confidence: 0.94, evidencePositions: [0] }],
    };
    const complete = vi.fn<OrganizationClient["complete"]>().mockResolvedValue({ content: JSON.stringify(payload), inputTokens: 100, outputTokens: 40 });
    const result = await organizeMaterialKnowledge({ title: "Askme overview", kind: "website", chunks: chunkMaterialText("Askme is an owner-isolated career knowledge base.") }, { complete });
    expect(result.organization).toEqual(payload);
    expect(complete.mock.calls[0]?.[1]).toEqual({ jsonObject: true, maxTokens: 4_000, temperature: 0.1 });
  });

  it("rejects unsupported categories and empty or malformed JSON", () => {
    expect(() => parseKnowledgeOrganization('{"materialSummary":"x","items":[{"type":"award","title":"x","summary":"x","highlights":[],"confidence":1}]}')).toThrowError(
      expect.objectContaining({ code: "AI_ORGANIZATION_INVALID" }) as Partial<AppError>,
    );
    expect(() => parseKnowledgeOrganization("not json")).toThrowError(expect.objectContaining({ code: "AI_ORGANIZATION_INVALID" }) as Partial<AppError>);
  });

  it("requires every organized item to name its supporting evidence chunks", () => {
    expect(() =>
      parseKnowledgeOrganization(
        '{"materialSummary":"x","items":[{"type":"project","title":"x","summary":"x","highlights":[],"confidence":1}]}'
      ),
    ).toThrowError(expect.objectContaining({ code: "AI_ORGANIZATION_INVALID" }) as Partial<AppError>);
    expect(() =>
      parseKnowledgeOrganization(
        '{"materialSummary":"x","items":[{"type":"project","title":"x","summary":"x","highlights":[],"confidence":1,"evidencePositions":[]}]}'
      ),
    ).toThrowError(expect.objectContaining({ code: "AI_ORGANIZATION_INVALID" }) as Partial<AppError>);
  });

  it("rejects duplicate evidence positions before persistence", () => {
    expect(() =>
      parseKnowledgeOrganization(
        '{"materialSummary":"x","items":[{"type":"project","title":"x","summary":"x","highlights":[],"confidence":1,"evidencePositions":[0,0]}]}'
      ),
    ).toThrowError(expect.objectContaining({ code: "AI_ORGANIZATION_INVALID" }) as Partial<AppError>);
  });

  it("reports an explicit terminal result when no career knowledge is grounded", async () => {
    const complete = vi.fn<OrganizationClient["complete"]>().mockResolvedValue({
      content: JSON.stringify({ materialSummary: "A generic placeholder website.", items: [] }),
      inputTokens: 20,
      outputTokens: 10,
    });
    await expect(
      organizeMaterialKnowledge({ title: "Example Domain", kind: "website", chunks: chunkMaterialText("This domain is for use in examples.") }, { complete }),
    ).rejects.toMatchObject({ code: "NO_CAREER_KNOWLEDGE" } satisfies Partial<AppError>);
  });
});
