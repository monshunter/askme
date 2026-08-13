import type { NextRequest } from "next/server";
import { z } from "zod";

import { requireRequestUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { createConnectedMaterial, recordConnectionFailure } from "@/server/materials/connect-service";
import type { ExternalSourceInput } from "@/server/materials/external-sources";

export const runtime = "nodejs";

const sourceUrl = z.string().trim().url().max(2_048);
const optionalToken = z.string().trim().min(1).max(2_000).optional();
const connectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("website"), url: sourceUrl }),
  z.object({ kind: z.literal("notion"), url: sourceUrl, targetType: z.enum(["page", "database"]).default("page"), token: optionalToken }),
]);

export async function POST(request: NextRequest) {
  const id = requestId(request);
  let ownerId: string | null = null;
  let attemptedKind: ExternalSourceInput["kind"] | null = null;
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    ownerId = user.id;
    if (Number(request.headers.get("content-length") ?? 0) > 32 * 1024) {
      throw new AppError("CONNECT_REQUEST_TOO_LARGE", "The connection request is too large.", 413);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError("INVALID_JSON", "Send a valid JSON connection request.", 400);
    }
    if (body && typeof body === "object" && "kind" in body && typeof body.kind === "string" && ["website", "notion"].includes(body.kind)) {
      attemptedKind = body.kind as ExternalSourceInput["kind"];
    }
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("INVALID_CONNECT_INPUT", "Check the source type, URL, target type, and credential fields.", 400, {
        fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]).filter((value): value is string => typeof value === "string"))],
      });
    }
    attemptedKind = parsed.data.kind;
    const material = await createConnectedMaterial(user.id, parsed.data, id);
    return apiData({ material }, id, { status: 201 });
  } catch (error) {
    if (ownerId && attemptedKind) {
      try {
        await recordConnectionFailure(ownerId, attemptedKind, error, id);
      } catch {
        // Preserve the original user-facing failure if audit persistence is unavailable.
      }
    }
    return apiFailure(error, id);
  }
}
