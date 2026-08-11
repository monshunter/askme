import "server-only";

import { getPool } from "@/server/db/client";
import type { VisibilityConsumer } from "@/server/privacy/visibility-policy";

import type { EvidenceQuery } from "./retrieval-input";
import { searchEvidence } from "./retrieval";

export function retrieveEvidence(ownerId: string, consumer: VisibilityConsumer, input: EvidenceQuery) {
  return searchEvidence(getPool(), ownerId, consumer, input);
}
