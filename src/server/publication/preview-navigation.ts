import { AppError } from "@/server/errors";

export function previewRecoveryPath(error: unknown) {
  return error instanceof AppError && error.code === "PUBLICATION_LINK_REQUIRED" ? "/workspace/publish" : null;
}
