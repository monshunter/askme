import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

function deriveKey(password: string, salt: Buffer, length: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELIZATION, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, costRaw, blockRaw, parallelRaw, saltRaw, hashRaw] = encoded.split("$");
  if (!algorithm || algorithm !== "scrypt" || !costRaw || !blockRaw || !parallelRaw || !saltRaw || !hashRaw) return false;

  const cost = Number(costRaw);
  const blockSize = Number(blockRaw);
  const parallelization = Number(parallelRaw);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) return false;

  const expected = Buffer.from(hashRaw, "base64url");
  const actual = await deriveKey(password, Buffer.from(saltRaw, "base64url"), expected.length, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createSessionCredential() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}
