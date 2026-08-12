import { safeExternalHref, sourceOpenMode, type MaterialKind, type SourceOpenMode } from "@/components/source-viewer-policy";
import type { MaterialVisibility } from "@/server/privacy/visibility-policy";

export type RawPublicCitation = {
  chunkId: string;
  rank: number;
  materialId: string;
  materialTitle: string;
  materialKind: MaterialKind;
  mimeType: string | null;
  externalUrl: string | null;
  visibility: MaterialVisibility;
};

export type PublicCitation = {
  materialTitle: string;
  access: { href: string; mode: SourceOpenMode } | null;
};

export function projectPublicCitations(slug: string, citations: RawPublicCitation[]): PublicCitation[] {
  const seenMaterialIds = new Set<string>();
  return citations.flatMap((citation) => {
    if (seenMaterialIds.has(citation.materialId)) return [];
    seenMaterialIds.add(citation.materialId);
    let access: PublicCitation["access"] = null;
    if (citation.visibility === "public_preview") {
      const href = citation.materialKind === "file"
        ? `/api/public/agents/${encodeURIComponent(slug)}/materials/${citation.materialId}`
        : safeExternalHref(citation.externalUrl);
      if (href) access = { href, mode: sourceOpenMode({ kind: citation.materialKind, title: citation.materialTitle, mimeType: citation.mimeType }) };
    }
    return [{
      materialTitle: citation.materialTitle,
      access,
    }];
  });
}
