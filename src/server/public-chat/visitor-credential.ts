import { createHash, randomBytes } from "node:crypto";

import ipaddr from "ipaddr.js";

export function visitorCookieName(slug: string) {
  return `askme_visitor_${slug.slice(0, 12)}`;
}

export function hashVisitorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createVisitorCredential(bytes: (size: number) => Uint8Array = randomBytes) {
  const token = Buffer.from(bytes(32)).toString("base64url");
  return { token, tokenHash: hashVisitorToken(token) };
}

export function validVisitorToken(token: string | undefined) {
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function requestClientAddress(headers: Headers) {
  const input = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  if (!ipaddr.isValid(input)) return "unknown";
  const parsed = ipaddr.parse(input);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) return (parsed as ipaddr.IPv6).toIPv4Address().toString();
  return parsed.toNormalizedString();
}
