import { safeOriginalName } from "./file-validation";

export type StoredMaterialContent = {
  id: string;
  ownerId: string;
  title: string;
  originalName: string | null;
  mimeType: string | null;
  storagePath: string;
};

function encodedFileName(name: string) {
  return encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function materialContentResponse(content: { material: StoredMaterialContent; bytes: Buffer }, cacheControl = "private, no-store") {
  const name = safeOriginalName(content.material.originalName ?? content.material.title);
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(content.bytes), {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Disposition": `inline; filename="${fallback}"; filename*=UTF-8''${encodedFileName(name)}`,
      "Content-Length": String(content.bytes.byteLength),
      "Content-Type": content.material.mimeType ?? "application/octet-stream",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
