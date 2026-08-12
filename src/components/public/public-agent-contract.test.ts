import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicAgentSource = readFileSync(new URL("./public-agent-client.tsx", import.meta.url), "utf8");

describe("Public Agent sharing contract", () => {
  it("copies the current Agent URL and reports the result", () => {
    expect(publicAgentSource).toContain("await navigator.clipboard.writeText(window.location.href)");
    expect(publicAgentSource).toContain('t("public.share.copied")');
    expect(publicAgentSource).toContain('t("public.share.copyBlocked")');
  });

  it("does not create a downloadable Agent link file", () => {
    expect(publicAgentSource).not.toContain("new Blob");
    expect(publicAgentSource).not.toContain("anchor.download");
    expect(publicAgentSource).not.toContain("public.download");
  });
});
