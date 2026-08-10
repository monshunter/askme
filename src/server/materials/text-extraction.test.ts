import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { extractTextFromBytes } from "./text-extraction";

function minimalPdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 33} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(source);
}

async function office(entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("material text extraction", () => {
  it("extracts visible text from a PDF", async () => {
    await expect(extractTextFromBytes("pdf", minimalPdf("Askme PDF Evidence"))).resolves.toContain("Askme PDF Evidence");
  });

  it("extracts paragraphs and tables from DOCX XML", async () => {
    const bytes = await office({
      "word/document.xml": '<?xml version="1.0"?><w:document xmlns:w="word"><w:body><w:p><w:r><w:t>Career project</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>42% improvement</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    });
    await expect(extractTextFromBytes("docx", bytes)).resolves.toMatch(/Career project[\s\S]*42% improvement/);
  });

  it("extracts ordered slide text from PPTX", async () => {
    const bytes = await office({
      "ppt/presentation.xml": "<p:presentation/>",
      "ppt/slides/slide2.xml": '<p:sld xmlns:a="a" xmlns:p="p"><a:t>Second slide</a:t></p:sld>',
      "ppt/slides/slide1.xml": '<p:sld xmlns:a="a" xmlns:p="p"><a:t>First slide</a:t></p:sld>',
    });
    const text = await extractTextFromBytes("pptx", bytes);
    expect(text.indexOf("First slide")).toBeLessThan(text.indexOf("Second slide"));
  });

  it("resolves shared and inline strings from XLSX sheets", async () => {
    const bytes = await office({
      "xl/workbook.xml": "<workbook/>",
      "xl/sharedStrings.xml": '<sst><si><t>Metric</t></si><si><t>Reliability</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>99.9</v></c><c t="inlineStr"><is><t>percent</t></is></c><c t="s"><v>1</v></c></row></sheetData></worksheet>',
    });
    await expect(extractTextFromBytes("xlsx", bytes)).resolves.toContain("Metric | 99.9 | percent | Reliability");
  });

  it.each([
    ["txt" as const, Buffer.from("Plain career evidence")],
    ["md" as const, Buffer.from("# Project\nMarkdown evidence")],
  ])("extracts UTF-8 %s", async (extension, bytes) => {
    await expect(extractTextFromBytes(extension, bytes)).resolves.toContain("evidence");
  });

  it("fails accurately when a supported container has no extractable text", async () => {
    const bytes = await office({ "word/document.xml": '<w:document xmlns:w="word"><w:body/></w:document>' });
    await expect(extractTextFromBytes("docx", bytes)).rejects.toMatchObject({ code: "MATERIAL_TEXT_EMPTY" } satisfies Partial<AppError>);
  });
});
