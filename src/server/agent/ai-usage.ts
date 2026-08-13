import type { Pool } from "pg";

export async function recordSuccessfulAiUsage(input: {
  pool: Pool;
  ownerId: string;
  purpose: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}) {
  if (input.inputTokens === null && input.outputTokens === null) return;
  await input.pool.query(
    `INSERT INTO ai_usage(owner_id,purpose,model,input_tokens,output_tokens,latency_ms,outcome)
     VALUES ($1,$2,$3,$4,$5,$6,'success')`,
    [input.ownerId, input.purpose, input.model, input.inputTokens, input.outputTokens, input.latencyMs],
  );
}
