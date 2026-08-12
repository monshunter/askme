import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("./candidate-shell.tsx", import.meta.url), "utf8");
const agentClientSource = readFileSync(new URL("./agent-preview-client.tsx", import.meta.url), "utf8");
const publicationControlsSource = readFileSync(new URL("./agent-publication-controls.tsx", import.meta.url), "utf8");
const privacyClientSource = readFileSync(new URL("./privacy-client.tsx", import.meta.url), "utf8");
const agentPageSource = readFileSync(new URL("../../app/workspace/agent/page.tsx", import.meta.url), "utf8");
const publicationServiceSource = readFileSync(new URL("../../server/publication/publication-service.ts", import.meta.url), "utf8");

describe("Candidate Workspace consolidation contract", () => {
  it("keeps only the primary navigation and no shell-level language switcher", () => {
    expect(shellSource).not.toContain("candidate.nav.publish");
    expect(shellSource).not.toContain("candidate.quick.");
    expect(shellSource).not.toContain("candidate.invite.");
    expect(shellSource).not.toContain("LanguageSwitcher");
  });

  it("retires the dedicated publishing pages", () => {
    expect(existsSync(new URL("../../app/workspace/publish/page.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../app/workspace/publish/preview/page.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../app/api/publications/preview/route.ts", import.meta.url))).toBe(false);
  });

  it("retires pre-generated Candidate Agent links and their API", () => {
    expect(existsSync(new URL("../../app/api/publications/link/route.ts", import.meta.url))).toBe(false);
    expect(publicationServiceSource).not.toContain("generatePublicationLink");
    expect(publicationControlsSource).not.toContain("share-link-card");
    expect(publicationControlsSource).not.toContain("/api/publications/link");
  });

  it("loads and renders publication management from the Agent page", () => {
    expect(agentPageSource).toContain("loadPublicationOverview");
    expect(agentClientSource).toContain("AgentPublicationControls");
  });

  it("synchronizes publication mutations with the Agent public-mode control", () => {
    expect(agentClientSource).toContain("onPublicModeChange");
    expect(publicationControlsSource).toContain("onPublicModeChange(payload.data.publicMode)");
  });

  it("hides the privacy confirmation action for the confirmed revision", () => {
    expect(privacyClientSource).toContain("!overview.confirmation.confirmed ? <button");
    expect(privacyClientSource).toContain("overview.confirmation.requiresReconfirmation ? t(\"privacy.confirm.again\") : t(\"privacy.confirm.submit\")");
  });

  it("places published Agent access before revocation", () => {
    expect(publicationControlsSource).toContain('t("publish.manage.visit")');
    expect(publicationControlsSource.indexOf('t("publish.manage.visit")')).toBeLessThan(publicationControlsSource.indexOf('t("publish.manage.revoke")'));
  });
});
