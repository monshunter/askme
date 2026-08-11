import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { adminInvitations, contentFlags, materials, messages } from "./schema";

describe("database schema alignment", () => {
  it("owns answer source invalidation on messages rather than materials", () => {
    expect(getTableColumns(materials)).not.toHaveProperty("sourceInvalidatedAt");
    expect(getTableColumns(messages).sourceInvalidatedAt?.name).toBe("source_invalidated_at");
  });

  it("exposes the persistent Admin invitation and review state owners", () => {
    const invitationColumns = getTableColumns(adminInvitations);
    expect(invitationColumns.tokenHash?.name).toBe("token_hash");
    expect(invitationColumns.status?.name).toBe("status");
    expect(invitationColumns.invitedBy?.name).toBe("invited_by");
    expect(invitationColumns.expiresAt?.name).toBe("expires_at");

    const flagColumns = getTableColumns(contentFlags);
    expect(flagColumns.safeSummary?.name).toBe("safe_summary");
    expect(flagColumns.reviewedBy?.name).toBe("reviewed_by");
    expect(flagColumns.reviewedAt?.name).toBe("reviewed_at");
  });
});
