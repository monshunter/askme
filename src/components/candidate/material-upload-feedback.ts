type UploadResult = {
  ok: boolean;
  name?: string;
  error?: { message?: string };
};

export function formatUploadFeedback(fileCount: number, payload: { failures?: number; items?: UploadResult[] }) {
  const failures = payload.failures ?? 0;
  if (failures === 0) return `${fileCount} file${fileCount === 1 ? "" : "s"} queued for indexing.`;

  const succeeded = Math.max(0, fileCount - failures);
  const details = payload.items
    ?.filter((item) => !item.ok)
    .map((item) => `${item.name ?? "File"}: ${item.error?.message ?? "Upload failed."}`)
    .join(" ");

  return details
    ? `${succeeded} file${succeeded === 1 ? "" : "s"} queued. ${details}`
    : `${succeeded} file${succeeded === 1 ? "" : "s"} queued; ${failures} failed validation.`;
}
