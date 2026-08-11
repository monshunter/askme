import { AppError } from "@/server/errors";

export function candidateStatusTransition(current: "active" | "suspended", requested: "active" | "suspended") {
  return { next: requested, changed: current !== requested } as const;
}

export function publicationStatusTransition(current: "draft" | "published" | "paused" | "revoked", action: "pause" | "restore") {
  if (action === "pause" && current === "paused") return { next: "paused", changed: false } as const;
  if (action === "restore" && current === "published") return { next: "published", changed: false } as const;
  if (action === "pause" && current === "published") return { next: "paused", changed: true } as const;
  if (action === "restore" && current === "paused") return { next: "published", changed: true } as const;
  throw new AppError("AGENT_STATE_CONFLICT", "The Agent state changed and cannot accept this governance action.", 409);
}

export function contentReviewTransition(current: "open" | "reviewing" | "resolved" | "dismissed", action: "review" | "resolve" | "dismiss") {
  if (current === "resolved" || current === "dismissed") {
    throw new AppError("REVIEW_STATE_CONFLICT", "This review item already has a terminal decision.", 409);
  }
  const next = action === "review" ? "reviewing" : action === "resolve" ? "resolved" : "dismissed";
  return { next, changed: current !== next } as const;
}
