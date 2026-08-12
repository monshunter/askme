import { describe, expect, it } from "vitest";

import { allowedVisibilities, canUseVisibility, type MaterialVisibility } from "./visibility-policy";

const visibilities: MaterialVisibility[] = ["private", "agent_only", "citation_allowed", "public_preview"];

describe("material visibility policy", () => {
  it("keeps private evidence out of every Agent consumer", () => {
    expect(visibilities.filter((visibility) => canUseVisibility("candidate_preview", visibility))).toEqual([
      "agent_only",
      "citation_allowed",
      "public_preview",
    ]);
    expect(visibilities.filter((visibility) => canUseVisibility("public_answer", visibility))).toEqual(["citation_allowed", "public_preview"]);
    expect(visibilities.filter((visibility) => canUseVisibility("public_highlight", visibility))).toEqual(["public_preview"]);
    expect(visibilities.filter((visibility) => canUseVisibility("public_file", visibility))).toEqual(["public_preview"]);
  });

  it("returns immutable exact allowlists for database filtering", () => {
    expect(allowedVisibilities("candidate_preview")).toEqual(["agent_only", "citation_allowed", "public_preview"]);
    expect(allowedVisibilities("public_answer")).toEqual(["citation_allowed", "public_preview"]);
    expect(allowedVisibilities("public_highlight")).toEqual(["public_preview"]);
    expect(allowedVisibilities("public_file")).toEqual(["public_preview"]);
  });
});
