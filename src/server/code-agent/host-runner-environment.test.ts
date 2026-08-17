import { describe, expect, it } from "vitest";

import { prepareHostRunnerEnvironment, resolveHostRunnerSettings } from "./host-runner-environment";

describe("host Runner environment", () => {
  it("uses project PostgreSQL and Web settings before ~/.env and safely encodes credentials", () => {
    const settings = resolveHostRunnerSettings({
      processEnv: {},
      projectEnvFile: [
        "ASKME_POSTGRES_USER=project-user",
        "ASKME_POSTGRES_PASSWORD=p@ss word",
        "ASKME_POSTGRES_DB=project/db",
        "ASKME_POSTGRES_PORT=6543",
        "ASKME_WEB_PORT=4321",
      ].join("\n"),
      userEnvFile: [
        "ASKME_POSTGRES_USER=user-file",
        "ASKME_POSTGRES_PASSWORD=user-secret",
        "ASKME_POSTGRES_DB=user-db",
        "ASKME_POSTGRES_PORT=55432",
        "ASKME_WEB_PORT=3000",
      ].join("\n"),
    });

    expect(settings).toEqual({
      databaseUrl: "postgresql://project-user:p%40ss%20word@127.0.0.1:6543/project%2Fdb",
      webPort: 4321,
    });
  });

  it("keeps explicit process values ahead of both env files", () => {
    const settings = resolveHostRunnerSettings({
      processEnv: { DATABASE_URL: "postgresql://process-db", ASKME_WEB_PORT: "4100" },
      projectEnvFile: "DATABASE_URL=postgresql://project-db\nASKME_WEB_PORT=4200\n",
      userEnvFile: "DATABASE_URL=postgresql://user-db\nASKME_WEB_PORT=4300\n",
    });

    expect(settings).toEqual({ databaseUrl: "postgresql://process-db", webPort: 4100 });
  });

  it("uses local defaults and removes the one-time GitHub sync token from the Runner", () => {
    const environment = prepareHostRunnerEnvironment({
      processEnv: { PATH: "/usr/bin", ASKME_GITHUB_TEST_TOKEN: "must-not-reach-runner" },
      projectEnvFile: "",
      userEnvFile: "",
    });

    expect(environment.DATABASE_URL).toBe("postgresql://askme:askme-local-only@127.0.0.1:55432/askme");
    expect(environment.PATH).toBe("/usr/bin");
    expect(environment).not.toHaveProperty("ASKME_GITHUB_TEST_TOKEN");
  });

  it("rejects invalid host ports instead of silently targeting another runtime", () => {
    expect(() => resolveHostRunnerSettings({ processEnv: { ASKME_POSTGRES_PORT: "0" }, projectEnvFile: "", userEnvFile: "" })).toThrow("ASKME_POSTGRES_PORT");
    expect(() => resolveHostRunnerSettings({ processEnv: { ASKME_WEB_PORT: "not-a-port" }, projectEnvFile: "", userEnvFile: "" })).toThrow("ASKME_WEB_PORT");
  });
});
