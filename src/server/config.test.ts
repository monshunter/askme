import { describe, expect, it } from "vitest";

import { loadConfigFromSources, parseAllowedEnv } from "./config";

describe("runtime config", () => {
  it("uses process environment before the user env file", () => {
    const config = loadConfigFromSources(
      {
        DATABASE_URL: "postgresql://process-db",
        DEEPSEEK_API_KEY: "process-key",
        DEEPSEEK_MODEL: "process-model",
      },
      "DATABASE_URL=postgresql://file-db\nDEEPSEEK_API_KEY=file-key\nDEEPSEEK_MODEL=file-model\n",
    );

    expect(config.databaseUrl).toBe("postgresql://process-db");
    expect(config.deepseek.apiKey).toBe("process-key");
    expect(config.deepseek.model).toBe("process-model");
  });

  it("loads allowlisted values from an env file and ignores unrelated keys", () => {
    const parsed = parseAllowedEnv(
      "export DEEPSEEK_API_KEY='file-key'\nDEEPSEEK_BASE_URL=\"https://example.test\"\nUNRELATED_SECRET=never-load\n",
    );

    expect(parsed).toEqual({
      DEEPSEEK_API_KEY: "file-key",
      DEEPSEEK_BASE_URL: "https://example.test",
    });
  });

  it("uses the approved DeepSeek defaults without inventing an API key", () => {
    const config = loadConfigFromSources({ DATABASE_URL: "postgresql://db" }, "");

    expect(config.deepseek).toEqual({
      apiKey: null,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
  });
});
