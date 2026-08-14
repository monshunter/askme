import { describe, expect, it } from "vitest";

import { parseAgentSettingsPatch } from "./agent-settings-input";

describe("parseAgentSettingsPatch", () => {
  it("accepts a strict non-empty partial settings update", () => {
    expect(parseAgentSettingsPatch({ answerTone: "concise", publicMode: true })).toEqual({ answerTone: "concise", publicMode: true });
    expect(parseAgentSettingsPatch({ privacySafeMode: false })).toEqual({ privacySafeMode: false });
  });

  it("rejects empty, unknown, or invalid settings", () => {
    for (const input of [{}, { answerTone: "verbose" }, { publicMode: "yes" }, { answerTone: "professional", extra: true }]) {
      expect(() => parseAgentSettingsPatch(input)).toThrowError(expect.objectContaining({ code: "INVALID_AGENT_SETTINGS" }));
    }
  });
});
