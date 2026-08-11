import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { materials, messages } from "./schema";

describe("database schema alignment", () => {
  it("owns answer source invalidation on messages rather than materials", () => {
    expect(getTableColumns(materials)).not.toHaveProperty("sourceInvalidatedAt");
    expect(getTableColumns(messages).sourceInvalidatedAt?.name).toBe("source_invalidated_at");
  });
});
