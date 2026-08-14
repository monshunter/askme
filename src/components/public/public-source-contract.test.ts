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

  it("owns public visitor identity in localStorage and sends it on API requests", () => {
    expect(clientSource).toContain("localStorage.getItem(PUBLIC_VISITOR_STORAGE_KEY)");
    expect(clientSource).toContain("localStorage.setItem(PUBLIC_VISITOR_STORAGE_KEY");
    expect(clientSource).toContain("[PUBLIC_VISITOR_HEADER]: visitorToken");
  });

  it("manages multiple visitor conversations through the session APIs", () => {
    expect(existsSync(new URL("../../app/api/public/agents/[slug]/sessions/route.ts", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../../app/api/public/agents/[slug]/sessions/[conversationId]/route.ts", import.meta.url))).toBe(true);
    expect(clientSource).toContain('className="public-session-panel"');
    expect(clientSource).toContain("createConversation()");
    expect(clientSource).toContain("selectSession(session.id)");
    expect(clientSource).toContain("deleteConversation(pendingDelete)");
    expect(clientSource).toContain("remaining[0]?.id ?? await createSessionRequest()");
  });

  it("scopes chat and related actions to the selected conversation", () => {
    expect(clientSource).toContain("JSON.stringify({ clientMessageId, conversationId, question: normalized })");
    expect(clientSource).toContain("JSON.stringify({ conversationId: thread.conversation.id })");
    expect(clientSource).toContain("feedback?conversationId=");
  });
});
