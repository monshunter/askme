import { createTranslator, type Locale } from "@/i18n/core";

type UploadResult = {
  ok: boolean;
  name?: string;
  error?: { message?: string };
};

export function formatUploadFeedback(fileCount: number, payload: { failures?: number; items?: UploadResult[] }, locale: Locale = "en") {
  const t = createTranslator(locale);
  const failures = payload.failures ?? 0;
  if (failures === 0) return locale === "en" ? `${fileCount} file${fileCount === 1 ? "" : "s"} queued for indexing.` : t("materials.upload.queued", { count: fileCount });

  const succeeded = Math.max(0, fileCount - failures);
  const details = payload.items
    ?.filter((item) => !item.ok)
    .map((item) => `${item.name ?? (locale === "en" ? "File" : "文件")}: ${locale === "en" ? item.error?.message ?? "Upload failed." : t("materials.upload.fileFailed")}`)
    .join(" ");

  if (locale !== "en") return details ? t("materials.upload.partialDetail", { succeeded, details }) : t("materials.upload.partial", { succeeded, failed: failures });
  return details ? `${succeeded} file${succeeded === 1 ? "" : "s"} queued. ${details}` : `${succeeded} file${succeeded === 1 ? "" : "s"} queued; ${failures} failed validation.`;
}
