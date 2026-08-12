import path from "node:path";

import JSZip from "jszip";

import { AppError } from "@/server/errors";

export const MAX_FILE_SIZE = 50 * 1024 * 1024;

const officeEntryByExtension = {
  docx: "word/document.xml",
  pptx: "ppt/presentation.xml",
  xlsx: "xl/workbook.xml",
} as const;

const expectedMimeTypes: Record<SupportedExtension, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain", "text/x-markdown"],
};

export type SupportedExtension = "pdf" | "docx" | "pptx" | "xlsx" | "txt" | "md";

export type UploadCandidate = {
  name: string;
  type: string;
  size: number;
  bytes: Buffer;
};

function supportedExtension(name: string): SupportedExtension {
  const extension = path.extname(name).slice(1).toLowerCase();
  if (!(extension in expectedMimeTypes)) {
    throw new AppError("UNSUPPORTED_FILE_TYPE", "Supported file types are PDF, DOCX, PPTX, XLSX, TXT, and Markdown.", 415);
  }
  return extension as SupportedExtension;
}

function validateMimeType(extension: SupportedExtension, type: string) {
  if (!type || type === "application/octet-stream") return;
  if (!expectedMimeTypes[extension].includes(type.toLowerCase())) {
    throw new AppError("FILE_TYPE_MISMATCH", "The file type does not match its extension.", 415);
  }
}

function validateText(bytes: Buffer) {
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0") || !content.trim()) throw new Error("Invalid text payload");
  } catch {
    throw new AppError("INVALID_TEXT_FILE", "The text file must contain valid UTF-8 text.", 422);
  }
}

export async function validateUpload(candidate: UploadCandidate) {
  if (!Number.isSafeInteger(candidate.size) || candidate.size < 1) {
    throw new AppError("EMPTY_FILE", "The selected file is empty.", 422);
  }
  if (candidate.size > MAX_FILE_SIZE) {
    throw new AppError("FILE_TOO_LARGE", "Each file must be 50 MiB or smaller.", 413);
  }
  if (candidate.size !== candidate.bytes.length) {
    throw new AppError("FILE_SIZE_MISMATCH", "The received file size is inconsistent.", 422);
  }

  const extension = supportedExtension(candidate.name);
  validateMimeType(extension, candidate.type);

  if (extension === "pdf") {
    if (candidate.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new AppError("FILE_SIGNATURE_MISMATCH", "The file content does not match a PDF document.", 422);
    }
  } else if (extension === "txt" || extension === "md") {
    validateText(candidate.bytes);
  } else {
    try {
      const archive = await JSZip.loadAsync(candidate.bytes);
      if (!archive.file(officeEntryByExtension[extension])) throw new Error("Missing Office document entry");
    } catch {
      throw new AppError("FILE_SIGNATURE_MISMATCH", "The file content does not match its Office document type.", 422);
    }
  }

  return { extension, mimeType: expectedMimeTypes[extension][0] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildStorageLocation(root: string, ownerId: string, materialId: string, extension: SupportedExtension) {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(materialId)) {
    throw new AppError("INVALID_STORAGE_ID", "The material storage identifier is invalid.", 500);
  }
  const absoluteRoot = path.resolve(root);
  const relativeDirectory = path.join(ownerId, materialId);
  const relativePath = path.join(relativeDirectory, `source.${extension}`);
  const absoluteDirectory = path.resolve(absoluteRoot, relativeDirectory);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  if (!absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new AppError("INVALID_STORAGE_PATH", "The material storage path is invalid.", 500);
  }
  return { absoluteDirectory, absolutePath, relativePath };
}

export function resolveStoredMaterialDirectory(root: string, ownerId: string, materialId: string, storagePath: string) {
  return path.dirname(resolveStoredMaterialPath(root, ownerId, materialId, storagePath));
}

export function resolveStoredMaterialPath(root: string, ownerId: string, materialId: string, storagePath: string) {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(materialId)) {
    throw new AppError("INVALID_STORAGE_ID", "The material storage identifier is invalid.", 500);
  }
  const absoluteRoot = path.resolve(root);
  const expectedDirectory = path.resolve(absoluteRoot, ownerId, materialId);
  const absoluteFile = path.resolve(absoluteRoot, storagePath);
  if (path.dirname(absoluteFile) !== expectedDirectory || !absoluteFile.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new AppError("INVALID_STORAGE_PATH", "The stored material path is outside its owner boundary.", 500);
  }
  return absoluteFile;
}

export function safeOriginalName(name: string) {
  const normalized = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return normalized.slice(0, 300) || "untitled";
}
