import type { Pool } from "pg";

import { DeepSeekClient } from "@/server/ai/deepseek";
import type { RuntimeConfig } from "@/server/config";
import { chunkMaterialText } from "@/server/knowledge/chunking";
import { organizeMaterialKnowledge, type OrganizationClient } from "@/server/knowledge/organizer";
import { extractStoredMaterialText } from "@/server/materials/text-extraction";

import { renewIngestionLease, type IngestionLease } from "./ingestion-jobs";
import { persistIngestionResult } from "./persist-ingestion";

type ProcessingDependencies = { organizerClient?: OrganizationClient };

export async function processIngestionLease(pool: Pool, lease: IngestionLease, config: RuntimeConfig, dependencies: ProcessingDependencies = {}) {
  const text = await extractStoredMaterialText(lease.material, config.uploadRoot);
  const chunks = chunkMaterialText(text);
  await renewIngestionLease(pool, lease, 120_000);
  const organizerClient = dependencies.organizerClient ?? new DeepSeekClient(config.deepseek, { timeoutMs: 60_000 });
  const { organization, usage } = await organizeMaterialKnowledge(
    { title: lease.material.title, kind: lease.material.kind, chunks },
    organizerClient,
  );
  await renewIngestionLease(pool, lease, 120_000);
  return persistIngestionResult(pool, lease, chunks, organization, usage, config.deepseek.model);
}
