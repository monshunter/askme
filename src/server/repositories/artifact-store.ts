import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { zstdCompress } from "node:zlib";

import JSZip, { type JSZipObject } from "jszip";
import { minimatch } from "minimatch";
import { create as createTar } from "tar";

import { AppError } from "@/server/errors";

import type { RepositoryArtifactStore } from "./repository-sync";

const compressZstd = promisify(zstdCompress);
const FILTER_VERSION = 2;
const DEFAULT_EXCLUDED_SEGMENTS = new Set([
  ".git", "node_modules", "vendor", ".next", "dist", "build", "target", "coverage", ".cache", "venv", ".venv", "__pycache__",
]);
const DEFAULT_BINARY_EXTENSIONS = new Set([
  ".7z", ".a", ".avi", ".bin", ".bmp", ".class", ".dll", ".dylib", ".eot", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg",
  ".mov", ".mp3", ".mp4", ".o", ".otf", ".pdf", ".png", ".so", ".tar", ".tif", ".tiff", ".ttf", ".wav", ".webm", ".webp", ".woff", ".woff2", ".zip",
]);
const DEFAULT_LIMITS = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxExtractedBytes: 500 * 1024 * 1024,
  maxFiles: 50_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxPathBytes: 1_024,
};

type ArtifactLimits = Partial<typeof DEFAULT_LIMITS>;

type ManifestFile = { path: string; size: number; contentHash: string };
type SkipReason = "binary" | "default_excluded" | "custom_excluded" | "special";
type RepositoryArtifactManifest = {
  version: 1;
  repository: string;
  commitSha: string;
  filterFingerprint: string;
  examinedFileCount: number;
  extractedBytes: number;
  files: ManifestFile[];
  skipped: Record<SkipReason, number>;
};

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeArchivePath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new AppError("REPOSITORY_ARCHIVE_UNSAFE_PATH", "The repository archive contains an unsafe path.", 422);
  }
  const segments = value.split("/").filter((segment, index, all) => !(segment === "" && index === all.length - 1));
  if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new AppError("REPOSITORY_ARCHIVE_UNSAFE_PATH", "The repository archive contains an unsafe path.", 422);
  }
  return segments;
}

function normalizeExcludePatterns(patterns: string[]) {
  const normalized = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  for (const pattern of normalized) {
    if (pattern.length > 1_024 || pattern.includes("\0") || pattern.includes("\\") || pattern.startsWith("/") || pattern.split("/").includes("..")) {
      throw new AppError("INVALID_REPOSITORY_EXCLUDE", "A repository exclude pattern is invalid.", 400);
    }
  }
  return [...new Set(normalized)].sort();
}

function isDefaultExcluded(relativePath: string) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment))) return true;
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if ([".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519", "credentials", "credentials.json", "secrets", "secrets.json"].includes(basename)) return true;
  return [".pem", ".key", ".p12", ".pfx", ".keystore"].some((suffix) => basename.endsWith(suffix));
}

function isKnownBinaryPath(relativePath: string) {
  return DEFAULT_BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function isSpecialFile(entry: JSZipObject) {
  if (entry.dir) return false;
  const permissions = typeof entry.unixPermissions === "number" ? entry.unixPermissions : null;
  if (permissions === null) return false;
  const fileType = permissions & 0o170000;
  return fileType !== 0 && fileType !== 0o100000;
}

function declaredSize(entry: JSZipObject) {
  const data = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data;
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : null;
}

function isText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

async function writeImmutable(target: string, bytes: Uint8Array, expectedHash: string) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  try {
    await writeFile(target, bytes, { flag: "wx", mode: 0o444 });
    await chmod(target, 0o444);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existing = await readFile(target);
    if (sha256(existing) !== expectedHash) {
      throw new AppError("REPOSITORY_ARTIFACT_COLLISION", "An immutable repository artifact has conflicting content.", 500);
    }
  }
}

export class FileSystemRepositoryArtifactStore implements RepositoryArtifactStore {
  private readonly limits: typeof DEFAULT_LIMITS;

  constructor(private readonly root: string, limits: ArtifactLimits = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  async remove(contentKey: string, storagePath: string) {
    if (!/^[0-9a-f]{64}$/.test(contentKey) || storagePath !== `${contentKey.slice(0, 2)}/${contentKey}.tar.zst`) {
      throw new AppError("REPOSITORY_ARTIFACT_PATH_INVALID", "The repository artifact path is invalid.", 500);
    }
    const targets = [
      path.join(this.root, storagePath),
      path.join(this.root, `${contentKey.slice(0, 2)}/${contentKey}.manifest.json`),
    ];
    for (const target of targets) {
      const relative = path.relative(this.root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new AppError("REPOSITORY_ARTIFACT_PATH_INVALID", "The repository artifact path is invalid.", 500);
      }
      try {
        await unlink(target);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
  }

  async store(input: {
    ownerId: string;
    canonicalUrl: string;
    commitSha: string;
    archive: Uint8Array;
    archiveChecksum: string;
    excludePatterns: string[];
  }) {
    if (input.archive.byteLength > this.limits.maxArchiveBytes) {
      throw new AppError("REPOSITORY_ARCHIVE_TOO_LARGE", "The repository archive exceeds the configured download limit.", 413);
    }
    if (sha256(input.archive) !== input.archiveChecksum) {
      throw new AppError("REPOSITORY_ARCHIVE_CHECKSUM_MISMATCH", "The repository archive checksum does not match the downloaded content.", 422);
    }
    const excludes = normalizeExcludePatterns(input.excludePatterns);
    const filterFingerprint = sha256(JSON.stringify({ version: FILTER_VERSION, excludes }));
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(input.archive, {
        checkCRC32: true,
        createFolders: false,
        decodeFileName: (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes as Uint8Array),
      });
    } catch {
      throw new AppError("REPOSITORY_ARCHIVE_INVALID", "The repository archive is not a valid UTF-8 ZIP archive.", 422);
    }
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      const unsafeOriginalName = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
      if (unsafeOriginalName && unsafeOriginalName !== entry.name) safeArchivePath(unsafeOriginalName);
      safeArchivePath(entry.name);
    }
    const files = entries.filter((entry) => !entry.dir);
    if (files.length > this.limits.maxFiles) throw new AppError("REPOSITORY_FILE_LIMIT_EXCEEDED", "The repository archive contains too many files.", 413);
    const rootSegments = new Set(files.map((entry) => safeArchivePath(entry.name)[0]));
    if (rootSegments.size !== 1) throw new AppError("REPOSITORY_ARCHIVE_ROOT_INVALID", "The repository archive must contain a single root directory.", 422);
    const rootSegment = [...rootSegments][0]!;
    const selected: Array<{ path: string; bytes: Uint8Array; contentHash: string }> = [];
    const skipped: Record<SkipReason, number> = { binary: 0, default_excluded: 0, custom_excluded: 0, special: 0 };
    let extractedBytes = 0;
    for (const entry of files) {
      const expectedBytes = declaredSize(entry);
      if (expectedBytes === null) continue;
      extractedBytes += expectedBytes;
      if (extractedBytes > this.limits.maxExtractedBytes) throw new AppError("REPOSITORY_EXTRACTED_TOO_LARGE", "The repository archive exceeds the configured extracted-size limit.", 413);
    }
    for (const entry of files.sort((left, right) => left.name.localeCompare(right.name))) {
      const segments = safeArchivePath(entry.name);
      if (segments[0] !== rootSegment || segments.length < 2) throw new AppError("REPOSITORY_ARCHIVE_ROOT_INVALID", "The repository archive must contain a single root directory.", 422);
      const relativePath = segments.slice(1).join("/");
      if (Buffer.byteLength(relativePath, "utf8") > this.limits.maxPathBytes) throw new AppError("REPOSITORY_PATH_TOO_LONG", "A repository path exceeds the configured limit.", 413);
      if (isSpecialFile(entry)) {
        skipped.special += 1;
        continue;
      }
      if (isDefaultExcluded(relativePath)) {
        skipped.default_excluded += 1;
        continue;
      }
      if (excludes.some((pattern) => minimatch(relativePath, pattern, { dot: true, nocase: false }))) {
        skipped.custom_excluded += 1;
        continue;
      }
      if (isKnownBinaryPath(relativePath)) {
        skipped.binary += 1;
        continue;
      }
      const expectedBytes = declaredSize(entry);
      if (expectedBytes !== null && expectedBytes > this.limits.maxFileBytes) throw new AppError("REPOSITORY_FILE_TOO_LARGE", "A repository file exceeds the configured limit.", 413);
      const bytes = await entry.async("uint8array");
      if (bytes.byteLength > this.limits.maxFileBytes) throw new AppError("REPOSITORY_FILE_TOO_LARGE", "A repository file exceeds the configured limit.", 413);
      if (expectedBytes === null) {
        extractedBytes += bytes.byteLength;
        if (extractedBytes > this.limits.maxExtractedBytes) throw new AppError("REPOSITORY_EXTRACTED_TOO_LARGE", "The repository archive exceeds the configured extracted-size limit.", 413);
      }
      if (!isText(bytes)) {
        skipped.binary += 1;
        continue;
      }
      selected.push({ path: relativePath, bytes, contentHash: sha256(bytes) });
    }
    if (selected.length === 0) throw new AppError("REPOSITORY_ARTIFACT_EMPTY", "No eligible repository text files remain after filtering.", 422);
    const manifest: RepositoryArtifactManifest = {
      version: 1,
      repository: input.canonicalUrl,
      commitSha: input.commitSha,
      filterFingerprint,
      examinedFileCount: files.length,
      extractedBytes,
      files: selected.map((file): ManifestFile => ({ path: file.path, size: file.bytes.byteLength, contentHash: file.contentHash })),
      skipped,
    };
    const manifestJson = `${JSON.stringify(manifest)}\n`;
    const manifestChecksum = sha256(manifestJson);
    const contentKey = sha256(`${manifestChecksum}\n${selected.map((file) => `${file.path}\0${file.contentHash}`).join("\n")}`);
    const temporary = await mkdtemp(path.join(os.tmpdir(), "askme-repository-artifact-"));
    try {
      const sourceRoot = path.join(temporary, "source");
      await mkdir(sourceRoot, { recursive: true, mode: 0o755 });
      for (const file of selected) {
        const target = path.join(sourceRoot, ...file.path.split("/"));
        await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
        await writeFile(target, file.bytes, { flag: "wx", mode: 0o444 });
        await chmod(target, 0o444);
      }
      const tarPath = path.join(temporary, "artifact.tar");
      await createTar({ cwd: sourceRoot, file: tarPath, portable: true, noMtime: true }, selected.map((file) => file.path));
      const compressed = new Uint8Array(await compressZstd(await readFile(tarPath)));
      const checksum = sha256(compressed);
      const storagePath = `${contentKey.slice(0, 2)}/${contentKey}.tar.zst`;
      const manifestPath = `${contentKey.slice(0, 2)}/${contentKey}.manifest.json`;
      const manifestBytes = new TextEncoder().encode(manifestJson);
      const ensureStored = async () => {
        await writeImmutable(path.join(this.root, storagePath), compressed, checksum);
        await writeImmutable(path.join(this.root, manifestPath), manifestBytes, manifestChecksum);
      };
      await ensureStored();
      const stored = await stat(path.join(this.root, storagePath));
      if (!stored.isFile()) throw new AppError("REPOSITORY_ARTIFACT_WRITE_FAILED", "The repository artifact was not stored as a regular file.", 500);
      const result = {
        contentKey,
        checksum,
        manifestChecksum,
        storagePath,
        compressedBytes: compressed.byteLength,
        extractedBytes,
        fileCount: selected.length,
        filterFingerprint,
        excludePatterns: excludes,
        manifest,
      };
      Object.defineProperty(result, "ensureStored", { value: ensureStored, enumerable: false });
      return result as typeof result & { ensureStored: () => Promise<void> };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
