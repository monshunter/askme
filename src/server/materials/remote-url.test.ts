import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { assertSafeRemoteUrl, isPublicAddress, type HostLookup } from "./remote-url";

function lookupFor(entries: Record<string, string[]>): HostLookup {
  return async (hostname) => (entries[hostname] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
}

describe("remote URL policy", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.8", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])(
    "rejects non-public address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(false);
    },
  );

  it.each(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("requires HTTP(S), no embedded credentials, and only public DNS answers", async () => {
    const lookup = lookupFor({
      "example.com": ["93.184.216.34"],
      "mixed.example": ["93.184.216.34", "127.0.0.1"],
      "private.example": ["10.0.0.5"],
    });

    await expect(assertSafeRemoteUrl("https://example.com/posts/1", lookup)).resolves.toMatchObject({ hostname: "example.com" });
    await expect(assertSafeRemoteUrl("file:///etc/passwd", lookup)).rejects.toMatchObject({ code: "UNSAFE_SOURCE_URL" } satisfies Partial<AppError>);
    await expect(assertSafeRemoteUrl("https://user:secret@example.com", lookup)).rejects.toMatchObject({ code: "UNSAFE_SOURCE_URL" } satisfies Partial<AppError>);
    await expect(assertSafeRemoteUrl("http://127.0.0.1:3000", lookup)).rejects.toMatchObject({ code: "UNSAFE_SOURCE_URL" } satisfies Partial<AppError>);
    await expect(assertSafeRemoteUrl("https://private.example", lookup)).rejects.toMatchObject({ code: "UNSAFE_SOURCE_HOST" } satisfies Partial<AppError>);
    await expect(assertSafeRemoteUrl("https://mixed.example", lookup)).rejects.toMatchObject({ code: "UNSAFE_SOURCE_HOST" } satisfies Partial<AppError>);
  });
});
