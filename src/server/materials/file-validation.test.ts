import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { MAX_FILE_SIZE, buildStorageLocation, resolveStoredMaterialDirectory, validateUpload } from "./file-validation";

async function officeZip(entry: string) {
  const zip = new JSZip();
  zip.file(entry, "<document>real content</document>");
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("material upload validation", () => {
  it.each([
    ["resume.pdf", "application/pdf", Buffer.from("%PDF-1.7\nreal pdf")],
    ["notes.txt", "text/plain", Buffer.from("plain UTF-8 text")],
    ["story.md", "text/markdown", Buffer.from("# Markdown\nreal text")],
  ])("accepts a valid %s", async (name, type, bytes) => {
    await expect(validateUpload({ name, type, size: bytes.length, bytes })).resolves.toMatchObject({ extension: name.split(".").pop() });
  });

  it.each([
    ["career.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word/document.xml"],
    ["architecture.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "ppt/presentation.xml"],
    ["metrics.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xl/workbook.xml"],
  ])("inspects the Office container for %s", async (name, type, entry) => {
    const bytes = await officeZip(entry);
    await expect(validateUpload({ name, type, size: bytes.length, bytes })).resolves.toMatchObject({ extension: name.split(".").pop() });
  });

  it("rejects an extension whose content signature is different", async () => {
    await expect(
      validateUpload({ name: "not-a-resume.pdf", type: "application/pdf", size: 12, bytes: Buffer.from("plain text!!") }),
    ).rejects.toMatchObject({ code: "FILE_SIGNATURE_MISMATCH" } satisfies Partial<AppError>);
  });

  it("rejects an Office zip that does not contain the claimed document type", async () => {
    const bytes = await officeZip("word/document.xml");
    await expect(
      validateUpload({ name: "fake.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: bytes.length, bytes }),
    ).rejects.toMatchObject({ code: "FILE_SIGNATURE_MISMATCH" } satisfies Partial<AppError>);
  });

  it("rejects invalid text and enforces the per-file size boundary", async () => {
    await expect(validateUpload({ name: "binary.txt", type: "text/plain", size: 3, bytes: Buffer.from([0x61, 0, 0x62]) })).rejects.toMatchObject({
      code: "INVALID_TEXT_FILE",
    } satisfies Partial<AppError>);
    await expect(validateUpload({ name: "large.md", type: "text/markdown", size: MAX_FILE_SIZE + 1, bytes: Buffer.from("# small sample") })).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    } satisfies Partial<AppError>);
  });

  it("builds a server-owned path below the configured upload root", () => {
    const location = buildStorageLocation(
      "/data/uploads",
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "pdf",
    );
    expect(location).toEqual({
      absoluteDirectory: "/data/uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222",
      absolutePath: "/data/uploads/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/source.pdf",
      relativePath: "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/source.pdf",
    });
  });

  it("resolves only a stored path inside the exact owner and material directory", () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const materialId = "22222222-2222-4222-8222-222222222222";
    expect(resolveStoredMaterialDirectory("/data/uploads", ownerId, materialId, `${ownerId}/${materialId}/source.md`)).toBe(
      `/data/uploads/${ownerId}/${materialId}`,
    );
    expect(() => resolveStoredMaterialDirectory("/data/uploads", ownerId, materialId, `${ownerId}/33333333-3333-4333-8333-333333333333/source.md`)).toThrowError(
      expect.objectContaining({ code: "INVALID_STORAGE_PATH" }),
    );
  });
});
