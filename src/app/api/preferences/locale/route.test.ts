import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { PUT } from "./route";

function localeRequest(localeBody: unknown, url = "http://127.0.0.1:3000/api/preferences/locale") {
  return new NextRequest(url, {
    method: "PUT",
    body: JSON.stringify(localeBody),
    headers: { "content-type": "application/json", "x-request-id": "locale-test" },
  });
}

describe("PUT /api/preferences/locale", () => {
  it("persists a supported anonymous locale without changing route state", async () => {
    const response = await PUT(localeRequest({ locale: "zh-CN" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { locale: "zh-CN" }, error: null, requestId: "locale-test" });
    expect(response.headers.get("set-cookie")).toContain("askme_locale=zh-CN");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=31536000");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("sets Secure for an HTTPS request", async () => {
    const response = await PUT(localeRequest({ locale: "en" }, "https://askme.example/api/preferences/locale"));
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects unsupported or malformed input with stable codes", async () => {
    const unsupported = await PUT(localeRequest({ locale: "fr" }));
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error.code).toBe("INVALID_LOCALE");

    const malformed = await PUT(new NextRequest("http://127.0.0.1:3000/api/preferences/locale", {
      method: "PUT",
      body: "not-json",
      headers: { "content-type": "application/json", "x-request-id": "locale-test" },
    }));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("INVALID_JSON");
  });
});
