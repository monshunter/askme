import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { FileSystemRepositoryArtifactStore } from "./artifact-store";
import { repositoryRevisionRetentionReasons } from "./artifact-retention";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Repository Artifact retention", () => {
  it("retains a revision for every active, Dossier, run or historical message-Citation reference", () => {
    expect(repositoryRevisionRetentionReasons({ active: true, dossier: false, run: false, messageCitation: false })).toEqual(["active"]);
    expect(repositoryRevisionRetentionReasons({ active: false, dossier: true, run: true, messageCitation: true })).toEqual(["dossier", "run", "message_citation"]);
    expect(repositoryRevisionRetentionReasons({ active: false, dossier: false, run: false, messageCitation: false })).toEqual([]);
  });

  it("deletes only the exact content-addressed archive and manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "askme-artifact-retention-test-"));
    roots.push(root);
    const zip = new JSZip();
    zip.file("repository-root/README.md", "# Repository\n");
    const archive = new Uint8Array(await zip.generateAsync({ type: "uint8array", platform: "UNIX" }));
    const store = new FileSystemRepositoryArtifactStore(root);
    const stored = await store.store({ ownerId: "owner", canonicalUrl: "https://github.com/org/repo", commitSha: "1".repeat(40), archive, archiveChecksum: createHash("sha256").update(archive).digest("hex"), excludePatterns: [] });

    await expect(store.remove(stored.contentKey, stored.storagePath)).resolves.toBeUndefined();
    await expect(store.remove(stored.contentKey, stored.storagePath)).resolves.toBeUndefined();
    await expect(store.remove(stored.contentKey, `../${stored.contentKey}.tar.zst`)).rejects.toMatchObject({ code: "REPOSITORY_ARTIFACT_PATH_INVALID" });
  });
});
