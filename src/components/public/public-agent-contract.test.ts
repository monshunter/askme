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

  it("matches Candidate preview suggestions and keeps only real sidebar content", () => {
    expect(publicAgentSource).toContain('className="suggestion-section public-suggestion-section"');
    expect(publicAgentSource).toContain('className="suggestion-grid"');
    expect(publicAgentSource).toContain('t("public.suggestions.title")');
    expect(publicAgentSource).not.toContain("public.learn.title");
    expect(publicAgentSource).not.toContain("public-learn-more");
  });

  it("gates the profile document icon entry on the projected designation", () => {
    expect(publicAgentSource).toContain("sourceOpenMode({ kind: \"file\"");
    expect(publicAgentSource).toContain('icon={<FileText size={16} />}');
    expect(publicAgentSource).toContain('className="public-profile-icon"');
    expect(publicAgentSource).not.toContain("public.profile.label");
  });
});
