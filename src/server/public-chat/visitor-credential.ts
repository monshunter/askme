import { createHash, randomBytes } from "node:crypto";

import ipaddr from "ipaddr.js";

import { PUBLIC_VISITOR_COOKIE, PUBLIC_VISITOR_HEADER } from "@/shared/public-visitor";

type VisitorRequest = {
  headers: Headers;
  cookies: { get(name: string): { value: string } | undefined };
};

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

function requestHeaderToken(request: VisitorRequest) {
  const header = request.headers.get(PUBLIC_VISITOR_HEADER);
  return header === null ? null : validVisitorToken(header) ?? undefined;
}

export function requestVisitorToken(request: VisitorRequest) {
  const headerToken = requestHeaderToken(request);
  if (headerToken !== null) return headerToken;
  return validVisitorToken(request.cookies.get(PUBLIC_VISITOR_COOKIE)?.value) ?? undefined;
}

export function requestSessionVisitorToken(request: VisitorRequest, slug: string) {
  const headerToken = requestHeaderToken(request);
  if (headerToken !== null) return headerToken;
  return validVisitorToken(request.cookies.get(visitorCookieName(slug))?.value) ?? undefined;
}

export function requestClientAddress(headers: Headers) {
  const input = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  if (!ipaddr.isValid(input)) return "unknown";
  const parsed = ipaddr.parse(input);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) return (parsed as ipaddr.IPv6).toIPv4Address().toString();
  return parsed.toNormalizedString();
}
