import dns from "node:dns";
import type { LookupFunction } from "node:net";

import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

import { AppError } from "@/server/errors";

export type LookupAddress = { address: string; family: number };
export type HostLookup = (hostname: string) => Promise<LookupAddress[]>;

const DNS_OVER_HTTPS_ENDPOINT = "https://cloudflare-dns.com/dns-query";

type DnsJsonResponse = { Status?: number; Answer?: Array<{ type?: number; data?: string }> };

async function lookupDnsRecord(hostname: string, type: "A" | "AAAA") {
  const endpoint = new URL(DNS_OVER_HTTPS_ENDPOINT);
  endpoint.searchParams.set("name", hostname);
  endpoint.searchParams.set("type", type);
  const response = await undiciFetch(endpoint, {
    headers: { accept: "application/dns-json" },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Public DNS lookup failed");
  const payload = (await response.json()) as DnsJsonResponse;
  if (payload.Status !== 0) return [];
  return (payload.Answer ?? [])
    .filter((answer) => (type === "A" ? answer.type === 1 : answer.type === 28) && typeof answer.data === "string" && ipaddr.isValid(answer.data))
    .map((answer) => ({ address: answer.data as string, family: type === "A" ? 4 : 6 }));
}

export const systemHostLookup: HostLookup = async (hostname) => {
  const [ipv4, ipv6] = await Promise.all([lookupDnsRecord(hostname, "A"), lookupDnsRecord(hostname, "AAAA")]);
  return [...ipv4, ...ipv6];
};

export function isPublicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6") {
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) parsed = ipv6.toIPv4Address();
  }
  return parsed.range() === "unicast";
}

function isTrustedDnsProxyAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.kind() === "ipv4" && (parsed as ipaddr.IPv4).match(ipaddr.parse("198.18.0.0") as ipaddr.IPv4, 15);
}

export async function assertSafeRemoteUrl(input: string, hostLookup: HostLookup = systemHostLookup) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("INVALID_SOURCE_URL", "Enter a valid source URL.", 400);
  }

  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password || !url.hostname) {
    throw new AppError("UNSAFE_SOURCE_URL", "Only public HTTP or HTTPS URLs without embedded credentials are allowed.", 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new AppError("UNSAFE_SOURCE_HOST", "The source host must be publicly routable.", 400);
  }

  const literalAddress = ipaddr.isValid(hostname);
  if (literalAddress && !isPublicAddress(hostname)) {
    throw new AppError("UNSAFE_SOURCE_URL", "Only public HTTP or HTTPS URLs are allowed.", 400);
  }

  let addresses: LookupAddress[];
  try {
    addresses = literalAddress ? [{ address: hostname, family: hostname.includes(":") ? 6 : 4 }] : await hostLookup(hostname);
  } catch {
    throw new AppError("SOURCE_HOST_UNRESOLVED", "The source host could not be resolved.", 422);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new AppError("UNSAFE_SOURCE_HOST", "The source host must resolve only to public addresses.", 400);
  }

  url.hostname = hostname;
  return url;
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, result) => {
    if (error) return callback(error, "", 0);
    const addresses = Array.isArray(result) ? result : [{ address: result, family: 0 }];
    if (addresses.length === 0 || addresses.some(({ address }) => !(isPublicAddress(address) || isTrustedDnsProxyAddress(address)))) {
      const unsafe = Object.assign(new Error("Remote host resolved to a non-public address."), { code: "EUNSAFEHOST" });
      return callback(unsafe, "", 0);
    }
    if (options.all) return callback(null, addresses);
    const selected = addresses[0];
    return callback(null, selected?.address ?? "", selected?.family ?? 0);
  });
};

const safeDispatcher = new Agent({
  connect: { lookup: guardedLookup, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

export async function pinnedPublicFetch(url: string, init?: RequestInit) {
  await assertSafeRemoteUrl(url, systemHostLookup);
  return undiciFetch(url, { ...init, dispatcher: safeDispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
}
