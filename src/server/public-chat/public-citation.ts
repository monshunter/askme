import { safeExternalHref, sourceOpenMode, type MaterialKind, type SourceOpenMode } from "@/components/source-viewer-policy";
import type { MaterialVisibility } from "@/server/privacy/visibility-policy";
import { documentSourceIdentity } from "@/server/agent/citation-dedup";

export type RawPublicDocumentCitation = {
  kind?: "document";
  chunkId: string;
  rank: number;
  materialId: string;
  contentChecksum: string | null;
  materialTitle: string;
  materialKind: MaterialKind;
  mimeType: string | null;
  externalUrl: string | null;
  visibility: MaterialVisibility;
};

export type RawPublicRepositoryCitation = {
  kind: "repository";
  messageId: string;
  rank: number;
  repositoryId: string;
  repositoryTitle: string;
  revisionId: string;
  commitSha: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  visibility: MaterialVisibility;
};

export type RawPublicCitation = RawPublicDocumentCitation | RawPublicRepositoryCitation;

export type PublicCitation = {
  materialTitle: string;
  access: { href: string; mode: SourceOpenMode } | null;
};

export function projectPublicCitations(slug: string, conversationId: string, citations: RawPublicCitation[]): PublicCitation[] {
  const seen = new Set<string>();
  return citations.flatMap((citation) => {
    if (citation.kind === "repository") {
      const key = `${citation.repositoryId}:${citation.revisionId}:${citation.path}:${citation.lineStart}:${citation.lineEnd}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const access = citation.visibility === "public_preview"
        ? {
            href: `/api/public/agents/${encodeURIComponent(slug)}/repositories/${citation.repositoryId}/source?${new URLSearchParams({
              messageId: citation.messageId,
              conversationId,
              revisionId: citation.revisionId,
              path: citation.path,
              lineStart: String(citation.lineStart),
              lineEnd: String(citation.lineEnd),
            }).toString()}`,
            mode: "repository" as const,
          }
        : null;
      return [{
        materialTitle: citation.visibility === "public_preview"
          ? `${citation.repositoryTitle} · ${citation.path}:${citation.lineStart}-${citation.lineEnd}`
          : citation.repositoryTitle,
        access,
      }];
    }
    const key = documentSourceIdentity(citation);
    if (seen.has(key)) return [];
    seen.add(key);
    let access: PublicCitation["access"] = null;
    if (citation.visibility === "public_preview") {
      const href = citation.materialKind === "file"
        ? `/api/public/agents/${encodeURIComponent(slug)}/materials/${citation.materialId}?conversationId=${encodeURIComponent(conversationId)}`
        : safeExternalHref(citation.externalUrl);
      if (href) access = { href, mode: sourceOpenMode({ kind: citation.materialKind, title: citation.materialTitle, mimeType: citation.mimeType }) };
    }
    return [{
      materialTitle: citation.materialTitle,
      access,
    }];
  });
}
