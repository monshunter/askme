export type MaterialKind = "file" | "github" | "notion" | "website";
export type SourceOpenMode = "markdown" | "pdf" | "new_tab";

export function sourceOpenMode(source: { kind: MaterialKind; title: string; mimeType: string | null }): SourceOpenMode {
  if (source.kind !== "file") return "new_tab";
  const title = source.title.toLowerCase();
  const mimeType = source.mimeType?.toLowerCase() ?? "";
  if (mimeType === "application/pdf" || title.endsWith(".pdf")) return "pdf";
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown" || title.endsWith(".md") || title.endsWith(".markdown")) return "markdown";
  return "new_tab";
}

export function safeExternalHref(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
