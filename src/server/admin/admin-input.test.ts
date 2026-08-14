import { describe, expect, it } from "vitest";

import {
  parseAdminListQuery,
  parseAdminRange,
  parseAgentListQuery,
  parseCandidateStatusInput,
  parseContentReviewInput,
  parseInvitationAcceptance,
  parseInvitationInput,
  parsePublicationActionInput,
  parseSettingsInput,
} from "./admin-input";

describe("Admin input contracts", () => {
  it("accepts only supported report ranges", () => {
    expect(parseAdminRange(undefined)).toBe("7d");
    expect(parseAdminRange("30d")).toBe("30d");
    expect(() => parseAdminRange("365d")).toThrow();
  });

  it("bounds search and pagination", () => {
    expect(parseAdminListQuery(new URLSearchParams("search=%20alice%20&page=2&pageSize=100"))).toEqual({
      search: "alice",
      page: 2,
      pageSize: 100,
    });
    expect(() => parseAdminListQuery(new URLSearchParams("pageSize=101"))).toThrow();
  });

  it("does not expose Candidate-only draft publications in Admin Agent filters", () => {
    expect(() => parseAgentListQuery(new URLSearchParams({ status: "draft" }))).toThrow();
  });

  it("requires explicit governance reasons and legal review decisions", () => {
    expect(parseCandidateStatusInput({ status: "suspended", reason: "Repeated abuse" })).toEqual({ status: "suspended", reason: "Repeated abuse" });
    expect(parsePublicationActionInput({ action: "restore", reason: "Review completed" })).toEqual({ action: "restore", reason: "Review completed" });
    expect(parseContentReviewInput({ action: "resolve", note: "Verified and mitigated" })).toEqual({ action: "resolve", note: "Verified and mitigated" });
    expect(() => parseCandidateStatusInput({ status: "active", reason: "x" })).toThrow();
    expect(() => parseContentReviewInput({ action: "dismiss", note: "no" })).toThrow();
  });

  it("accepts only known non-secret platform policy keys", () => {
    expect(parseSettingsInput({ publicChatMinuteLimit: 12, negativeFeedbackAutoFlag: false })).toEqual({
      publicChatMinuteLimit: 12,
      negativeFeedbackAutoFlag: false,
    });
    expect(() => parseSettingsInput({ deepseekApiKey: "secret" })).toThrow();
    expect(() => parseSettingsInput({ publicChatDailyLimit: 100 })).toThrow();
  });

  it("validates real Admin invitation and acceptance inputs", () => {
    expect(parseInvitationInput({ email: "ADMIN@example.test", displayName: "New Admin" })).toEqual({ email: "admin@example.test", displayName: "New Admin" });
    expect(parseInvitationAcceptance({ displayName: "New Admin", password: "A secure password 2026!" })).toEqual({ displayName: "New Admin", password: "A secure password 2026!" });
    expect(() => parseInvitationInput({ email: "not-an-email", displayName: "Admin" })).toThrow();
    expect(() => parseInvitationAcceptance({ displayName: "Admin", password: "short" })).toThrow();
  });
});
