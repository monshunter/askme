import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync(new URL("./candidate-shell.tsx", import.meta.url), "utf8");
const adminShellSource = readFileSync(new URL("../admin/admin-shell.tsx", import.meta.url), "utf8");
const agentClientSource = readFileSync(new URL("./agent-preview-client.tsx", import.meta.url), "utf8");
const publicationControlsSource = readFileSync(new URL("./agent-publication-controls.tsx", import.meta.url), "utf8");
const privacyClientSource = readFileSync(new URL("./privacy-client.tsx", import.meta.url), "utf8");
const materialsClientSource = readFileSync(new URL("./materials-client.tsx", import.meta.url), "utf8");
const knowledgeClientSource = readFileSync(new URL("./knowledge-client.tsx", import.meta.url), "utf8");
const dashboardPageSource = readFileSync(new URL("../../app/workspace/page.tsx", import.meta.url), "utf8");
const agentPageSource = readFileSync(new URL("../../app/workspace/agent/page.tsx", import.meta.url), "utf8");
const publicationServiceSource = readFileSync(new URL("../../server/publication/publication-service.ts", import.meta.url), "utf8");
const accountPageSource = readFileSync(new URL("../../app/workspace/account/page.tsx", import.meta.url), "utf8");

describe("Candidate Workspace consolidation contract", () => {
  it("keeps only the primary navigation and no shell-level language switcher", () => {
    expect(shellSource).not.toContain("candidate.nav.publish");
    expect(shellSource).not.toContain("candidate.quick.");
    expect(shellSource).not.toContain("candidate.invite.");
    expect(shellSource).not.toContain("LanguageSwitcher");
  });

  it("removes header search and quick actions without retiring domain search pages", () => {
    expect(shellSource).not.toContain("global-search");
    expect(shellSource).not.toContain("useSearchShortcut");
    expect(adminShellSource).not.toContain("admin-global-search");
    expect(adminShellSource).not.toContain("admin-quick-actions");
    expect(adminShellSource).not.toContain("useSearchShortcut");
    expect(existsSync(new URL("../../app/admin/search/page.tsx", import.meta.url))).toBe(true);
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

  it("requires confirmation before resetting the owner preview conversation", () => {
    expect(agentClientSource).toContain('requestApi<ApiEnvelope<PreviewThread>>("/api/agent/preview", { method: "DELETE" })');
    expect(agentClientSource).toContain('t("agent.reset.title")');
    expect(agentClientSource).toContain('t("agent.reset.confirm")');
    expect(agentClientSource).toContain("useModalFocus");
  });

  it("synchronizes publication mutations with the Agent public-mode control", () => {
    expect(agentClientSource).toContain("onPublicModeChange");
    expect(publicationControlsSource).toContain("onPublicModeChange(payload.data.publicMode)");
  });

  it("routes blocked public identity to the editable profile and preserves the Agent return path", () => {
    expect(publicationControlsSource).toContain('/workspace/account?returnTo=/workspace/agent#public-profile');
    expect(accountPageSource).toContain('id="public-profile"');
    expect(accountPageSource).toContain('action="/api/auth/profile"');
  });

  it("hides the privacy confirmation action for the confirmed revision", () => {
    expect(privacyClientSource).toContain("!overview.confirmation.confirmed ? <button");
    expect(privacyClientSource).toContain("overview.confirmation.requiresReconfirmation ? t(\"privacy.confirm.again\") : t(\"privacy.confirm.submit\")");
  });

  it("places published Agent access before revocation", () => {
    expect(publicationControlsSource).toContain('t("publish.manage.visit")');
    expect(publicationControlsSource.indexOf('t("publish.manage.visit")')).toBeLessThan(publicationControlsSource.indexOf('t("publish.manage.revoke")'));
  });

  it("curates public highlights from the Candidate Agent page", () => {
    expect(agentPageSource).toContain("loadHighlightCuration");
    expect(agentPageSource).toContain("initialHighlights");
    expect(agentClientSource).toContain('requestApi<ApiEnvelope<HighlightCuration>>(`/api/agent/highlights?page=');
    expect(agentClientSource).toContain('requestApi<ApiEnvelope<{ featured: FeaturedHighlightItem[] }>>("/api/agent/highlights"');
    expect(agentClientSource).toContain('t("agent.highlights.title")');
    expect(agentClientSource).toContain('t("agent.highlights.rotate")');
    expect(agentClientSource).toContain('t("agent.highlights.limit")');
  });

  it("uses one owner-scoped source viewer from every Candidate material surface", () => {
    for (const source of [dashboardPageSource, materialsClientSource, knowledgeClientSource, privacyClientSource, agentClientSource]) {
      expect(source).toContain("CandidateSourceLink");
    }
    expect(existsSync(new URL("../../app/api/materials/[materialId]/content/route.ts", import.meta.url))).toBe(true);
  });

  it("lets the Candidate designate one public-preview file as the profile document", () => {
    expect(agentClientSource).toContain('t("agent.profile.title")');
    expect(agentClientSource).toContain('t("agent.profile.empty")');
    expect(agentClientSource).toContain('requestApi<ApiEnvelope<{ items: Array<{ id: string; title: string; mimeType: string | null; kind: "file" | "notion" | "website"; visibility: Visibility }> }>>(');
    expect(agentClientSource).toContain('updateSetting("profileMaterialId", null)');
    expect(agentClientSource).toContain('updateSetting("profileMaterialId", item.id)');
  });
});
