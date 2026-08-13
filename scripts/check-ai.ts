import { OpenAiChatClient } from "../src/server/ai/openai-compatible";
import { getRuntimeConfig } from "../src/server/config";

async function main() {
  const config = getRuntimeConfig();
  const startedAt = Date.now();
  const client = new OpenAiChatClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, profile: config.ai.profiles.rag });
  await client.complete([
    { role: "system", content: "You are an availability check. Reply with exactly OK." },
    { role: "user", content: "health check" },
  ]);
  console.info(JSON.stringify({ event: "ai.check.completed", model: config.ai.profiles.rag.model, latencyMs: Date.now() - startedAt }));
}

main().catch((error: unknown) => {
  const code = error instanceof Error && "code" in error ? error.code : "AI_CHECK_FAILED";
  console.error(JSON.stringify({ event: "ai.check.failed", code }));
  process.exitCode = 1;
});
