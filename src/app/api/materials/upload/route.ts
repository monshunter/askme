import type { NextRequest } from "next/server";

import { requireRequestUser } from "@/server/auth/current";
import { AppError, toAppError } from "@/server/errors";
import { apiData, apiFailure, requestId } from "@/server/http";
import { MAX_FILE_SIZE } from "@/server/materials/file-validation";
import { createUploadedMaterial } from "@/server/materials/upload-service";

export const runtime = "nodejs";

const MAX_FILES_PER_REQUEST = 10;

function isFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && typeof value.arrayBuffer === "function";
}

export async function POST(request: NextRequest) {
  const id = requestId(request);
  try {
    const user = await requireRequestUser(request, ["candidate"]);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FILE_SIZE * MAX_FILES_PER_REQUEST + 1024 * 1024) {
      throw new AppError("UPLOAD_REQUEST_TOO_LARGE", "Upload at most 10 files of 50 MiB each.", 413);
    }

    const form = await request.formData();
    const files = form.getAll("files").filter(isFile);
    if (files.length < 1) throw new AppError("FILES_REQUIRED", "Select at least one file.", 400);
    if (files.length > MAX_FILES_PER_REQUEST) throw new AppError("TOO_MANY_FILES", "Upload at most 10 files at a time.", 400);

    const results = await Promise.allSettled(
      files.map(async (file) => {
        const bytes = Buffer.from(await file.arrayBuffer());
        return createUploadedMaterial(user.id, { name: file.name, type: file.type, size: file.size, bytes }, id);
      }),
    );
    const items = results.map((result, index) => {
      if (result.status === "fulfilled") return { ok: true as const, material: result.value };
      const error = toAppError(result.reason);
      return { ok: false as const, name: files[index]?.name ?? "unknown", error: { code: error.code, message: error.message } };
    });
    const failures = items.filter((item) => !item.ok).length;
    return apiData({ items, failures }, id, { status: failures === 0 ? 201 : 207 });
  } catch (error) {
    return apiFailure(error, id);
  }
}
