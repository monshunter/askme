export type DocumentSourceIdentity = {
  materialId: string;
  contentChecksum?: string | null;
};

export function documentSourceIdentity(source: DocumentSourceIdentity) {
  return source.contentChecksum || source.materialId;
}

export function deduplicateDocumentSources<T extends DocumentSourceIdentity>(sources: T[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const identity = documentSourceIdentity(source);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function deduplicateDocumentChunks<T extends DocumentSourceIdentity & { position: number }>(chunks: T[]) {
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    const identity = `${documentSourceIdentity(chunk)}:${chunk.position}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
