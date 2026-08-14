import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";

import { list as listTar, type ReadEntry } from "tar";
import { z } from "zod";

import { AppError } from "@/server/errors";

import type { DossierArtifactEvidence } from "./dossier-output";

const decompressZstd = promisify(zstdDecompress);
const manifestSchema = z.object({
  version: z.literal(1),
  repository: z.string().url(),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  filterFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  examinedFileCount: z.number().int().nonnegative(),
  extractedBytes: z.number().int().nonnegative(),
  files: z.array(z.object({
    path: z.string().min(1).max(1_024),
    size: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).min(1).max(50_000),
  skipped: z.object({
    binary: z.number().int().nonnegative(),
    default_excluded: z.number().int().nonnegative(),
    custom_excluded: z.number().int().nonnegative(),
    special: z.number().int().nonnegative().default(0),
  }).strict(),
}).strict();
type RepositoryArtifactManifest = z.infer<typeof manifestSchema>;

export type RepositoryArtifactDescriptor = {
  contentKey: string;
  checksum: string;
  manifestChecksum: string;
  storagePath: string;
  canonicalUrl: string;
  commitSha: string;
  filterFingerprint: string;
  fileCount: number;
};

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveRepositoryArtifactFiles(root: string, descriptor: RepositoryArtifactDescriptor) {
  const expected = `${descriptor.contentKey.slice(0, 2)}/${descriptor.contentKey}.tar.zst`;
  if (!/^[0-9a-f]{64}$/.test(descriptor.contentKey) || descriptor.storagePath !== expected) {
    throw new AppError("REPOSITORY_ARTIFACT_PATH_INVALID", "The Repository Artifact path is invalid.", 500);
  }
  const absolute = path.join(root, descriptor.storagePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("REPOSITORY_ARTIFACT_PATH_INVALID", "The Repository Artifact path is invalid.", 500);
  }
  return {
    artifactPath: absolute,
    manifestPath: path.join(root, `${descriptor.contentKey.slice(0, 2)}/${descriptor.contentKey}.manifest.json`),
  };
}

async function readRequestedFiles(tarBytes: Uint8Array, manifestFiles: Map<string, { size: number; contentHash: string }>, requestedPaths: Set<string>) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "askme-repository-reader-"));
  const tarPath = path.join(temporary, "artifact.tar");
  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  const reads: Promise<void>[] = [];
  try {
    await writeFile(tarPath, tarBytes, { flag: "wx", mode: 0o400 });
    await listTar({
      file: tarPath,
      strict: true,
      onentry(entry: ReadEntry) {
        const manifestFile = manifestFiles.get(entry.path);
        if (!manifestFile || entry.type !== "File") {
          entry.resume();
          if (requestedPaths.has(entry.path)) {
            reads.push(Promise.reject(new AppError("REPOSITORY_ARTIFACT_CONTENT_INVALID", "The Repository Artifact contains an unexpected entry.", 500)));
          }
          return;
        }
        seen.add(entry.path);
        if (!requestedPaths.has(entry.path)) {
          entry.resume();
          return;
        }
        reads.push((async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of entry) chunks.push(Buffer.from(chunk));
          const bytes = Buffer.concat(chunks);
          if (bytes.byteLength !== manifestFile.size || sha256(bytes) !== manifestFile.contentHash) {
            throw new AppError("REPOSITORY_ARTIFACT_CONTENT_INVALID", "A Repository Artifact source does not match its immutable manifest.", 500);
          }
          files.set(entry.path, bytes);
        })());
      },
    });
    await Promise.all(reads);
    for (const requestedPath of requestedPaths) {
      if (!seen.has(requestedPath) || !files.has(requestedPath)) {
        throw new AppError("REPOSITORY_ARTIFACT_SOURCE_NOT_FOUND", "A requested Repository source is absent from the immutable Artifact.", 422);
      }
    }
    return files;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("REPOSITORY_ARTIFACT_CONTENT_INVALID", "The Repository Artifact cannot be read safely.", 500);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function loadVerifiedArtifact(root: string, descriptor: RepositoryArtifactDescriptor): Promise<{ artifactBytes: Buffer; manifest: RepositoryArtifactManifest; manifestPaths: Set<string> }> {
  const { artifactPath, manifestPath } = resolveRepositoryArtifactFiles(root, descriptor);
  let artifactBytes: Buffer;
  let manifestBytes: Buffer;
  try {
    [artifactBytes, manifestBytes] = await Promise.all([
      readFile(/* turbopackIgnore: true */ artifactPath),
      readFile(/* turbopackIgnore: true */ manifestPath),
    ]);
  } catch {
    throw new AppError("REPOSITORY_ARTIFACT_UNAVAILABLE", "The immutable Repository Artifact is unavailable.", 500);
  }
  if (sha256(artifactBytes) !== descriptor.checksum) {
    throw new AppError("REPOSITORY_ARTIFACT_CHECKSUM_MISMATCH", "The immutable Repository Artifact checksum does not match.", 500);
  }
  if (sha256(manifestBytes) !== descriptor.manifestChecksum) {
    throw new AppError("REPOSITORY_MANIFEST_CHECKSUM_MISMATCH", "The Repository Artifact manifest checksum does not match.", 500);
  }

  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new AppError("REPOSITORY_MANIFEST_INVALID", "The Repository Artifact manifest is invalid.", 500);
  }
  const parsed = manifestSchema.safeParse(manifestInput);
  if (!parsed.success) throw new AppError("REPOSITORY_MANIFEST_INVALID", "The Repository Artifact manifest is invalid.", 500);
  const manifest = parsed.data;
  const filePaths = manifest.files.map((file) => file.path);
  const manifestPaths = new Set(filePaths);
  const recomputedContentKey = sha256(`${descriptor.manifestChecksum}\n${manifest.files.map((file) => `${file.path}\0${file.contentHash}`).join("\n")}`);
  if (
    manifest.repository !== descriptor.canonicalUrl
    || manifest.commitSha !== descriptor.commitSha
    || manifest.filterFingerprint !== descriptor.filterFingerprint
    || manifest.files.length !== descriptor.fileCount
    || manifestPaths.size !== manifest.files.length
    || recomputedContentKey !== descriptor.contentKey
  ) {
    throw new AppError("REPOSITORY_MANIFEST_MISMATCH", "The Repository Artifact manifest does not match its Revision.", 500);
  }
  return { artifactBytes, manifest, manifestPaths };
}

export async function readRepositoryArtifactManifest(root: string, descriptor: RepositoryArtifactDescriptor) {
  const { manifest, manifestPaths } = await loadVerifiedArtifact(root, descriptor);
  return { manifestFiles: manifest.files, manifestPaths, artifactSkipped: manifest.skipped };
}

export async function readRepositoryArtifactFiles(root: string, descriptor: RepositoryArtifactDescriptor, requestedPaths: string[]) {
  const { artifactBytes, manifest, manifestPaths } = await loadVerifiedArtifact(root, descriptor);
  const requested = new Set(requestedPaths);
  if (requested.size !== requestedPaths.length || requestedPaths.some((requestedPath) => !manifestPaths.has(requestedPath))) {
    throw new AppError("REPOSITORY_ARTIFACT_SOURCE_NOT_FOUND", "A requested Repository source is absent from the immutable Artifact.", 422);
  }
  let tarBytes: Uint8Array;
  try {
    tarBytes = new Uint8Array(await decompressZstd(artifactBytes));
  } catch {
    throw new AppError("REPOSITORY_ARTIFACT_CONTENT_INVALID", "The Repository Artifact cannot be decompressed safely.", 500);
  }
  const manifestFiles = new Map(manifest.files.map((file) => [file.path, { size: file.size, contentHash: file.contentHash }]));
  const files = await readRequestedFiles(tarBytes, manifestFiles, requested);
  return { eligibleFileCount: manifest.files.length, manifestFiles: manifest.files, manifestPaths, files, artifactSkipped: manifest.skipped };
}

export async function readRepositoryArtifactEvidence(
  root: string,
  descriptor: RepositoryArtifactDescriptor,
  requestedPaths: string[],
): Promise<DossierArtifactEvidence> {
  const result = await readRepositoryArtifactFiles(root, descriptor, requestedPaths);
  const sources = new Map<string, string>();
  for (const [filePath, bytes] of result.files) {
    try {
      sources.set(filePath, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AppError("REPOSITORY_ARTIFACT_CONTENT_INVALID", "A Repository Artifact source is not valid UTF-8 text.", 500);
    }
  }
  return {
    eligibleFileCount: result.eligibleFileCount,
    manifestPaths: result.manifestPaths,
    sources,
    artifactSkipped: result.artifactSkipped,
  };
}
