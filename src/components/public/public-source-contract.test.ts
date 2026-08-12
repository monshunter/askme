import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(new URL("./public-agent-client.tsx", import.meta.url), "utf8");

describe("public source presentation contract", () => {
  it("renders only the source name with its projected access capability", () => {
    expect(clientSource).toContain("<SourceLink");
    expect(clientSource).not.toContain("citation.excerpt");
    expect(clientSource).not.toContain("citation.materialKind");
    expect(clientSource).not.toContain("citation.externalUrl");
  });

  it("has a dedicated public source route that can recheck current permission", () => {
    expect(existsSync(new URL("../../app/api/public/agents/[slug]/materials/[materialId]/route.ts", import.meta.url))).toBe(true);
  });
});
