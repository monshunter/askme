import { AppError } from "./errors";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireResourceId(value: string, resource: "material" | "knowledge" | "conversation" | "message" | "repository" | "analysis_run") {
  if (UUID_PATTERN.test(value)) return value;
  if (resource === "material") throw new AppError("MATERIAL_NOT_FOUND", "The material was not found.", 404);
  if (resource === "knowledge") throw new AppError("KNOWLEDGE_NOT_FOUND", "The knowledge item was not found.", 404);
  if (resource === "conversation") throw new AppError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
  if (resource === "repository") throw new AppError("REPOSITORY_NOT_FOUND", "The Repository was not found.", 404);
  if (resource === "analysis_run") throw new AppError("ANALYSIS_RUN_NOT_FOUND", "The Analysis Run was not found.", 404);
  throw new AppError("MESSAGE_NOT_FOUND", "The message was not found.", 404);
}
