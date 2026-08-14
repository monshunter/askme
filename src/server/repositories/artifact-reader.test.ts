import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "@/server/errors";

import { readRepositoryArtifactEvidence, readRepositoryArtifactFiles } from "./artifact-reader";
import { FileSystemRepositoryArtifactStore } from "./artifact-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "askme-artifact-reader-test-"));
  roots.push(root);
  const zip = new JSZip();
  zip.file("repository-root/src/index.ts", "export const answer = 42;\n");
  zip.file("repository-root/README.md", "# Repository\n");
  zip.file("repository-root/.env", "SECRET=excluded\n");
  const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
  const stored = await new FileSystemRepositoryArtifactStore(root).store({
    ownerId: "owner",
    canonicalUrl: "https://github.com/org/repository",
    commitSha: "a".repeat(40),
    archive,
    archiveChecksum: createHash("sha256").update(archive).digest("hex"),
    excludePatterns: [],
  });
  return { root, stored };
}

function descriptor(stored: Awaited<ReturnType<typeof fixture>>["stored"]) {
  return {
    contentKey: stored.contentKey,
    checksum: stored.checksum,
    manifestChecksum: stored.manifestChecksum,
    storagePath: stored.storagePath,
    canonicalUrl: "https://github.com/org/repository",
    commitSha: "a".repeat(40),
    filterFingerprint: stored.filterFingerprint,
    fileCount: stored.fileCount,
  };
}

describe("Repository Artifact reader", () => {
  it("revalidates immutable metadata and extracts only requested source files", async () => {
    const { root, stored } = await fixture();
    const result = await readRepositoryArtifactEvidence(root, descriptor(stored), ["src/index.ts"]);

    expect([...result.manifestPaths].sort()).toEqual(["README.md", "src/index.ts"]);
    expect(result.sources.get("src/index.ts")).toBe("export const answer = 42;\n");
    expect(result.sources.has("README.md")).toBe(false);
    expect(result.artifactSkipped.default_excluded).toBe(1);
  });

  it("returns verified binary bytes only through the explicit immutable file reader", async () => {
    const { root, stored } = await fixture();
    const result = await readRepositoryArtifactFiles(root, descriptor(stored), ["README.md"]);

    expect(result.files.get("README.md")?.toString("utf8")).toBe("# Repository\n");
    expect(result.manifestFiles.find((file) => file.path === "README.md")?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unknown requested paths and tampered manifests", async () => {
    const { root, stored } = await fixture();
    await expect(readRepositoryArtifactEvidence(root, descriptor(stored), ["src/missing.ts"])).rejects.toMatchObject({ code: "REPOSITORY_ARTIFACT_SOURCE_NOT_FOUND" } satisfies Partial<AppError>);

    const manifestPath = path.join(root, `${stored.contentKey.slice(0, 2)}/${stored.contentKey}.manifest.json`);
    await chmod(manifestPath, 0o644);
    await writeFile(manifestPath, `${await readFile(manifestPath, "utf8")} `);
    await expect(readRepositoryArtifactEvidence(root, descriptor(stored), [])).rejects.toMatchObject({ code: "REPOSITORY_MANIFEST_CHECKSUM_MISMATCH" } satisfies Partial<AppError>);
  });
});
