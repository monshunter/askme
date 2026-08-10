import { toAppError } from "@/server/errors";

const TERMINAL_ERROR_CODES = new Set([
  "AI_NOT_CONFIGURED",
  "AI_AUTH_FAILED",
  "EMPTY_FILE",
  "INVALID_STORAGE_PATH",
  "MATERIAL_CHUNK_LIMIT",
  "MATERIAL_DOCX_INVALID",
  "MATERIAL_FILE_MISSING",
  "MATERIAL_PDF_INVALID",
  "MATERIAL_PPTX_INVALID",
  "MATERIAL_TEXT_EMPTY",
  "MATERIAL_TEXT_INVALID",
  "MATERIAL_TEXT_TOO_LARGE",
  "MATERIAL_XLSX_INVALID",
  "NO_CAREER_KNOWLEDGE",
  "UNSUPPORTED_FILE_TYPE",
]);

export function ingestionFailureDecision(error: unknown, attempt: number, maxAttempts: number) {
  const safeError = toAppError(error);
  const terminal = TERMINAL_ERROR_CODES.has(safeError.code) || attempt >= maxAttempts;
  const backoffSeconds = terminal ? null : Math.min(300, 15 * 2 ** Math.max(0, attempt - 1));
  return {
    code: safeError.code,
    message: safeError.message,
    outcome: terminal ? ("failed" as const) : ("retry_scheduled" as const),
    backoffSeconds,
  };
}
