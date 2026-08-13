import { describe, expect, it } from "vitest";

// @ts-expect-error The guest runtime ships as native ESM JavaScript inside the OCI image.
import { parseFinalJson, selectFinalAssistantText } from "./final-output.mjs";

describe("Code Agent guest final output", () => {
  it("uses the last non-empty successful Assistant text when Pi appends an empty terminal message", () => {
    const selected = selectFinalAssistantText([
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: '{"claims":[]}' }] },
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "" }] },
    ]);

    expect(selected?.text).toBe('{"claims":[]}');
  });

  it("does not fall back past a newer non-empty Assistant response", () => {
    const selected = selectFinalAssistantText([
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: '{"claims":[]}' }] },
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "not json" }] },
    ]);

    expect(selected?.text).toBe("not json");
  });

  it("parses fenced or briefly wrapped JSON without repairing invalid JSON", () => {
    expect(parseFinalJson('```json\n{"claims":[]}\n```')).toEqual({ claims: [] });
    expect(parseFinalJson('Result:\n{"claims":[]}\nDone.')).toEqual({ claims: [] });
    expect(() => parseFinalJson('{"claims":[}')).toThrow();
  });
});
