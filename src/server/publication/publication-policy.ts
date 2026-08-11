import { randomBytes } from "node:crypto";

import { AppError } from "@/server/errors";

export type PublishReadinessFacts = {
  indexedMaterials: number;
  policyRevision: number;
  confirmedRevision: number | null;
  displayName: string;
  headline: string | null;
};

export function evaluatePublishReadiness(facts: PublishReadinessFacts) {
  const checks = [
    {
      key: "indexed_material" as const,
      label: "Indexed source material",
      detail: facts.indexedMaterials > 0 ? `${facts.indexedMaterials} indexed source${facts.indexedMaterials === 1 ? "" : "s"} available.` : "Add and finish indexing at least one source.",
      ready: facts.indexedMaterials > 0,
    },
    {
      key: "privacy_confirmation" as const,
      label: "Current privacy policy confirmed",
      detail: facts.confirmedRevision === facts.policyRevision ? `Privacy revision ${facts.policyRevision} is confirmed.` : `Confirm privacy revision ${facts.policyRevision} before publishing.`,
      ready: facts.confirmedRevision === facts.policyRevision,
    },
    {
      key: "public_identity" as const,
      label: "Public identity is ready",
      detail: facts.displayName.trim() && facts.headline?.trim() ? "Name and headline are available for the public profile." : "Add a display name and professional headline.",
      ready: Boolean(facts.displayName.trim() && facts.headline?.trim()),
    },
  ];
  return { ready: checks.every((check) => check.ready), checks };
}

export function createPublicSlug(bytes: (size: number) => Uint8Array = randomBytes) {
  return Buffer.from(bytes(24)).toString("base64url");
}

export function parsePublicSlug(value: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(value)) {
    throw new AppError("PUBLIC_AGENT_UNAVAILABLE", "This public Agent is unavailable.", 404);
  }
  return value;
}
