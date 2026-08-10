export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
