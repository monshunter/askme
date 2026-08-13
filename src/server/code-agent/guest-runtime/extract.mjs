import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { zstdDecompress } from "node:zlib";

import { extract } from "tar";

const decompress = promisify(zstdDecompress);
const INPUT_ROOT = "/workspace/input";
const SOURCE_ROOT = "/workspace/source";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const [expectedArtifactChecksum, expectedManifestChecksum] = process.argv.slice(2);
  if (!/^[0-9a-f]{64}$/.test(expectedArtifactChecksum ?? "") || !/^[0-9a-f]{64}$/.test(expectedManifestChecksum ?? "")) {
    throw new Error("invalid artifact bootstrap checksums");
  }
  const [archive, manifestBytes] = await Promise.all([
    readFile(path.join(INPUT_ROOT, "repository.tar.zst")),
    readFile(path.join(INPUT_ROOT, "manifest.json")),
  ]);
  if (sha256(archive) !== expectedArtifactChecksum || sha256(manifestBytes) !== expectedManifestChecksum) {
    throw new Error("artifact bootstrap checksum mismatch");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error("invalid artifact manifest");

  const tarBytes = await decompress(archive);
  await mkdir(SOURCE_ROOT, { recursive: true, mode: 0o555 });
  const tarPath = path.join(INPUT_ROOT, "repository.tar");
  await writeFile(tarPath, tarBytes, { mode: 0o400, flag: "wx" });
  await extract({ file: tarPath, cwd: SOURCE_ROOT, strict: true, preservePaths: false });

  for (const file of manifest.files) {
    if (typeof file?.path !== "string" || file.path.length === 0 || path.isAbsolute(file.path) || file.path.split("/").includes("..")) {
      throw new Error("invalid artifact manifest path");
    }
    const absolute = path.resolve(SOURCE_ROOT, file.path);
    if (!absolute.startsWith(`${SOURCE_ROOT}${path.sep}`)) throw new Error("artifact path escaped source root");
    await chmod(absolute, 0o444);
  }
  await chmod(SOURCE_ROOT, 0o555);
  process.stdout.write(`${JSON.stringify({ ready: true, fileCount: manifest.files.length })}\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : "artifact bootstrap failed"));
