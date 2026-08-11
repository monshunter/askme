import { describe, expect, it } from "vitest";

import { formatUploadFeedback } from "./material-upload-feedback";

describe("material upload feedback", () => {
  it("reports the failed file and server message", () => {
    expect(
      formatUploadFeedback(1, {
        failures: 1,
        items: [{ ok: false, name: "career.md", error: { message: "The file type does not match its extension." } }],
      }),
    ).toBe("0 files queued. career.md: The file type does not match its extension.");
  });

  it("keeps a count fallback for malformed partial responses", () => {
    expect(formatUploadFeedback(2, { failures: 1 })).toBe("1 file queued; 1 failed validation.");
  });

  it("reports successful single-file uploads", () => {
    expect(formatUploadFeedback(1, { failures: 0 })).toBe("1 file queued for indexing.");
  });

  it("keeps partial upload feedback in the selected Chinese locale", () => {
    expect(formatUploadFeedback(3, { failures: 1 }, "zh-CN")).toBe("2 个文件已进入队列；1 个未通过校验。");
  });
});
