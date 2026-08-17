import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/errors";

const getPublicProfileMaterialContent = vi.hoisted(() => vi.fn());
vi.mock("@/server/materials/material-content-service", () => ({ getPublicProfileMaterialContent }));

import { GET } from "./route";

const VALID_SLUG = "abcdefghijklmnopqrstuvwxyz012345";

const pdfContent = {
  material: { id: "22222222-2222-4222-8222-222222222222", ownerId: "11111111-1111-4111-8111-111111111111", title: "resume.pdf", originalName: "resume.pdf", mimeType: "application/pdf", storagePath: "/uploads/resume.pdf" },
  bytes: new Uint8Array([37, 80, 68, 70, 10]),
};

describe("GET /api/public/agents/[slug]/profile", () => {
  it("serves the designated profile document bytes without any visitor conversation", async () => {
    getPublicProfileMaterialContent.mockResolvedValueOnce(pdfContent);
    const response = await GET(new NextRequest(`http://127.0.0.1:3000/api/public/agents/${VALID_SLUG}/profile`), { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(response.status).toBe(200);
    expect(getPublicProfileMaterialContent).toHaveBeenCalledWith(VALID_SLUG);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(await response.arrayBuffer()).toEqual(pdfContent.bytes.buffer as ArrayBuffer);
  });

  it("returns 404 when no eligible profile document is designated", async () => {
    getPublicProfileMaterialContent.mockRejectedValueOnce(new AppError("PUBLIC_SOURCE_NOT_FOUND", "The public source was not found.", 404));
    const response = await GET(new NextRequest(`http://127.0.0.1:3000/api/public/agents/${VALID_SLUG}/profile`), { params: Promise.resolve({ slug: VALID_SLUG }) });
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error.code).toBe("PUBLIC_SOURCE_NOT_FOUND");
  });
});
