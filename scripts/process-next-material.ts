import os from "node:os";

import { Pool } from "pg";

import { getRuntimeConfig, requireDatabaseUrl } from "../src/server/config";
import { claimNextIngestionJob } from "../src/server/jobs/ingestion-jobs";
import { processIngestionLease } from "../src/server/jobs/process-ingestion";

const config = getRuntimeConfig();
const pool = new Pool({ connectionString: requireDatabaseUrl(), max: 3 });
try {
  const lease = await claimNextIngestionJob(pool, `one-shot:${os.hostname()}:${process.pid}`, 120_000);
  if (!lease) throw new Error("No due ingestion job is available");
  const result = await processIngestionLease(pool, lease, config);
  console.log(
    JSON.stringify({
      event: "ingestion.one-shot.completed",
      materialId: result.materialId,
      attempt: lease.attempt,
      chunkCount: result.chunkCount,
      knowledgeItemCount: result.knowledgeItemIds.length,
      model: config.ai.profiles.rag.model,
    }),
  );
} finally {
  await pool.end();
}
