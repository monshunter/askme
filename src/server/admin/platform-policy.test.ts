import { describe, expect, it } from "vitest";

import { DEFAULT_PLATFORM_POLICIES, policyEntries, resolvePlatformPolicies } from "./platform-policy";

describe("platform policies", () => {
  it("uses safe defaults and ignores unknown or invalid persisted values", () => {
    expect(resolvePlatformPolicies([])).toEqual(DEFAULT_PLATFORM_POLICIES);
    expect(resolvePlatformPolicies([
      { key: "public_chat_minute_limit", value: 12 },
      { key: "negative_feedback_auto_flag", value: false },
      { key: "public_chat_daily_limit", value: 10 },
      { key: "deepseek_api_key", value: "secret" },
    ])).toEqual({ ...DEFAULT_PLATFORM_POLICIES, publicChatMinuteLimit: 12, negativeFeedbackAutoFlag: false });
  });

  it("ignores the historical public daily question-count setting", () => {
    expect(resolvePlatformPolicies([{ key: "public_chat_daily_limit", value: 1 }])).toEqual(DEFAULT_PLATFORM_POLICIES);
    expect(DEFAULT_PLATFORM_POLICIES).not.toHaveProperty("publicChatDailyLimit");
  });

  it("serializes only explicit supported updates", () => {
    expect(policyEntries({ publicSessionHourlyLimit: 25, negativeFeedbackAutoFlag: false })).toEqual([
      { key: "public_session_hourly_limit", value: 25 },
      { key: "negative_feedback_auto_flag", value: false },
    ]);
  });
});
