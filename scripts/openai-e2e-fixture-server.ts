import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.ASKME_OPENAI_FIXTURE_PORT ?? "3210", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("ASKME_OPENAI_FIXTURE_PORT must be a valid TCP port");
}

type ChatMessage = { role?: string; content?: string };
type ChatRequest = { model?: string; messages?: ChatMessage[] };

function completion(model: string, content: string) {
  return {
    id: "chatcmpl-askme-e2e-fixture",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 32, completion_tokens: 16, total_tokens: 48 },
  };
}

function fixtureContent(messages: ChatMessage[]) {
  const system = messages.find((message) => message.role === "system")?.content ?? "";

  if (system.includes("Route one career-Agent question")) {
    return JSON.stringify({
      route: "rag",
      reason: "The authorized evidence packet can answer the question.",
      confidence: 1,
      repositoryId: null,
    });
  }

  if (system.includes("You organize candidate-owned career evidence")) {
    return JSON.stringify({
      materialSummary: "The supplied career evidence describes a grounded Agent delivery and its measured impact.",
      items: [
        {
          type: "project",
          title: "Grounded career Agent delivery",
          summary: "The candidate delivered a career Agent backed by source-level evidence.",
          highlights: ["Source-level evidence and candidate-controlled visibility"],
          confidence: 1,
          evidencePositions: [0],
        },
      ],
    });
  }

  if (system.includes("You are a candidate career Agent")) {
    return JSON.stringify({
      answer: "The supplied authorized evidence supports the reported career result.",
      citations: [1],
    });
  }

  return JSON.stringify({ answer: "Fixture response", citations: [1] });
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Not found" } }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > 1_000_000) throw new Error("Request body exceeds fixture limit");
      chunks.push(buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatRequest;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(completion(body.model ?? "askme-e2e-fixture", fixtureContent(messages))));
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Invalid fixture request" } }));
  }
});

server.listen(port, host, () => {
  console.info(JSON.stringify({ event: "openai-e2e-fixture.started", host, port }));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close());
}
