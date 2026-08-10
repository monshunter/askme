import { DeepSeekClient } from "../src/server/ai/deepseek";
import { getRuntimeConfig } from "../src/server/config";

async function main() {
  const config = getRuntimeConfig();
  const startedAt = Date.now();
  const client = new DeepSeekClient(config.deepseek, { timeoutMs: 45_000 });
  await client.complete([
    { role: "system", content: "You are an availability check. Reply with exactly OK." },
    { role: "user", content: "health check" },
  ]);
  console.info(JSON.stringify({ event: "ai.check.completed", model: config.deepseek.model, latencyMs: Date.now() - startedAt }));
}

main().catch((error: unknown) => {
  const code = error instanceof Error && "code" in error ? error.code : "AI_CHECK_FAILED";
  console.error(JSON.stringify({ event: "ai.check.failed", code }));
  process.exitCode = 1;
});
