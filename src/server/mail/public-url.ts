import "server-only";

import { getRuntimeConfig } from "@/server/config";

export function buildPublicUrl(baseUrl: string, pathname: string) {
  return new URL(pathname, baseUrl).toString();
}

export function publicAppUrl(pathname: string) {
  return buildPublicUrl(getRuntimeConfig().publicBaseUrl, pathname);
}
