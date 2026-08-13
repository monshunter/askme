import path from "node:path";
import { readFile } from "node:fs/promises";

import { load } from "cheerio";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { AppError } from "@/server/errors";

import { resolveStoredMaterialDirectory, type SupportedExtension } from "./file-validation";

function normalizeExtractedText(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function requireText(text: string) {
  const normalized = normalizeExtractedText(text);
  if (!normalized) throw new AppError("MATERIAL_TEXT_EMPTY", "The material does not contain extractable text.", 422);
  return normalized;
}

async function extractPdf(bytes: Buffer) {
  let task: ReturnType<typeof getDocument> | null = null;
  let document: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
  try {
    task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    document = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      if (text.trim()) pages.push(text);
      page.cleanup();
    }
    return requireText(pages.join("\n\n"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MATERIAL_PDF_INVALID", "The PDF could not be read.", 422);
  } finally {
    await task?.destroy();
  }
}

function xmlText(xml: string, paragraphClosings: RegExp) {
  const withBreaks = xml.replace(paragraphClosings, "$&\n");
  return load(withBreaks, { xmlMode: true }).root().text();
}

async function extractDocx(bytes: Buffer) {
  try {
    const archive = await JSZip.loadAsync(bytes);
    const document = await archive.file("word/document.xml")?.async("string");
    if (!document) throw new Error("Missing document XML");
    return requireText(xmlText(document, /<\/(?:w:p|w:tr)>/gi));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MATERIAL_DOCX_INVALID", "The Word document could not be read.", 422);
  }
}

function numberedPath(pathname: string) {
  const value = Number(pathname.match(/(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

async function extractPptx(bytes: Buffer) {
  try {
    const archive = await JSZip.loadAsync(bytes);
    const slides = Object.keys(archive.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((left, right) => numberedPath(left) - numberedPath(right));
    const content: string[] = [];
    for (const slide of slides) {
      const xml = await archive.file(slide)?.async("string");
      if (xml) content.push(xmlText(xml, /<\/(?:a:p|a:t)>/gi));
    }
    return requireText(content.join("\n\n"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MATERIAL_PPTX_INVALID", "The presentation could not be read.", 422);
  }
}

async function extractXlsx(bytes: Buffer) {
  try {
    const archive = await JSZip.loadAsync(bytes);
    const sharedXml = await archive.file("xl/sharedStrings.xml")?.async("string");
    const shared: string[] = [];
    if (sharedXml) {
      const $shared = load(sharedXml, { xmlMode: true });
      $shared("si").each((_, element) => {
        shared.push(normalizeExtractedText($shared(element).text()));
      });
    }
    const sheets = Object.keys(archive.files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort((left, right) => numberedPath(left) - numberedPath(right));
    const rows: string[] = [];
    for (const sheet of sheets) {
      const xml = await archive.file(sheet)?.async("string");
      if (!xml) continue;
      const $ = load(xml, { xmlMode: true });
      $("row").each((_, row) => {
        const cells: string[] = [];
        $(row)
          .find("c")
          .each((__, cell) => {
            const type = $(cell).attr("t");
            const raw = type === "inlineStr" ? $(cell).find("is").text() : $(cell).find("v").first().text();
            const value = type === "s" ? shared[Number(raw)] ?? "" : raw;
            if (value.trim()) cells.push(normalizeExtractedText(value));
          });
        if (cells.length > 0) rows.push(cells.join(" | "));
      });
    }
    return requireText(rows.join("\n"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MATERIAL_XLSX_INVALID", "The spreadsheet could not be read.", 422);
  }
}

function extractUtf8(bytes: Buffer) {
  try {
    return requireText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MATERIAL_TEXT_INVALID", "The text material is not valid UTF-8.", 422);
  }
}

export async function extractTextFromBytes(extension: SupportedExtension, bytes: Buffer) {
  if (extension === "pdf") return extractPdf(bytes);
  if (extension === "docx") return extractDocx(bytes);
  if (extension === "pptx") return extractPptx(bytes);
  if (extension === "xlsx") return extractXlsx(bytes);
  return extractUtf8(bytes);
}

export type StoredMaterial = {
  id: string;
  ownerId: string;
  title: string;
  kind: "file" | "notion" | "website";
  originalName: string | null;
  storagePath: string | null;
};

export async function extractStoredMaterialText(material: StoredMaterial, uploadRoot: string) {
  if (!material.storagePath) throw new AppError("MATERIAL_FILE_MISSING", "The material does not have a stored file.", 422);
  const directory = resolveStoredMaterialDirectory(uploadRoot, material.ownerId, material.id, material.storagePath);
  const absolutePath = path.resolve(uploadRoot, material.storagePath);
  if (path.dirname(absolutePath) !== directory) throw new AppError("INVALID_STORAGE_PATH", "The stored material path is invalid.", 500);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    throw new AppError("MATERIAL_FILE_MISSING", "The stored material file is unavailable.", 422);
  }
  const extension = material.kind === "file" ? path.extname(material.originalName ?? material.storagePath).slice(1).toLowerCase() : "txt";
  if (!(["pdf", "docx", "pptx", "xlsx", "txt", "md"] as string[]).includes(extension)) {
    throw new AppError("UNSUPPORTED_FILE_TYPE", "The stored material type is not supported.", 415);
  }
  return extractTextFromBytes(extension as SupportedExtension, bytes);
}
