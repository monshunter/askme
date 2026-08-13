import type { Notification, Pool, PoolClient } from "pg";

import { AppError } from "@/server/errors";

export type AnalysisRunSnapshot = {
  id: string;
  version: number;
  state: "pending" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  outcome: "answered" | "insufficient" | "refused" | null;
  safeErrorCode: string | null;
  assistantMessageId: string | null;
};

function terminal(state: AnalysisRunSnapshot["state"]) {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function encodeAnalysisRunEvent(snapshot: AnalysisRunSnapshot) {
  const completed = terminal(snapshot.state);
  return `id: ${snapshot.version}\nevent: run\ndata: ${JSON.stringify({
    runId: snapshot.id,
    version: snapshot.version,
    state: snapshot.state,
    phase: snapshot.phase,
    outcome: snapshot.outcome,
    errorCode: snapshot.safeErrorCode,
    completed,
    ...(completed && snapshot.assistantMessageId ? { messageId: snapshot.assistantMessageId } : {}),
  })}\n\n`;
}

export async function analysisRunSseResponse(input: {
  request: Request;
  pool: Pool;
  runId: string;
  loadSnapshot: (client: PoolClient) => Promise<AnalysisRunSnapshot | null>;
}) {
  const client = await input.pool.connect();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;
  let refreshQueued = false;
  let refreshing = false;
  let latestVersion = 0;
  const encoder = new TextEncoder();

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    input.request.signal.removeEventListener("abort", close);
    client.off("notification", onNotification);
    client.off("error", onClientError);
    void client.query("UNLISTEN askme_analysis_run").catch(() => undefined).finally(() => client.release());
    try { controller?.close(); } catch { /* The consumer may already have closed. */ }
  };

  const sendSnapshot = async () => {
    if (closed || refreshing || !controller) return;
    refreshing = true;
    try {
      do {
        refreshQueued = false;
        const snapshot = await input.loadSnapshot(client);
        if (!snapshot) {
          controller.enqueue(encoder.encode("event: invalidated\ndata: {\"invalidated\":true}\n\n"));
          close();
          return;
        }
        if (snapshot.version > latestVersion) {
          latestVersion = snapshot.version;
          controller.enqueue(encoder.encode(encodeAnalysisRunEvent(snapshot)));
        }
        if (terminal(snapshot.state)) {
          close();
          return;
        }
      } while (refreshQueued && !closed);
    } catch {
      if (!closed) {
        controller.enqueue(encoder.encode("event: invalidated\ndata: {\"invalidated\":true}\n\n"));
        close();
      }
    } finally {
      refreshing = false;
    }
  };

  function onNotification(notification: Notification) {
    if (notification.channel !== "askme_analysis_run" || !notification.payload) return;
    try {
      const payload = JSON.parse(notification.payload) as { runId?: unknown; version?: unknown };
      if (payload.runId !== input.runId || typeof payload.version !== "number" || payload.version <= latestVersion) return;
      refreshQueued = true;
      void sendSnapshot();
    } catch {
      // Ignore malformed notifications; a reconnect always reloads the current database snapshot.
    }
  }

  function onClientError() {
    if (!closed) close();
  }

  try {
    client.on("notification", onNotification);
    client.on("error", onClientError);
    await client.query("LISTEN askme_analysis_run");
    const initial = await input.loadSnapshot(client);
    if (!initial) throw new AppError("ANALYSIS_RUN_NOT_FOUND", "The Analysis Run is unavailable.", 404);
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        latestVersion = initial.version;
        controller.enqueue(encoder.encode(encodeAnalysisRunEvent(initial)));
        if (terminal(initial.state)) {
          close();
          return;
        }
        heartbeat = setInterval(() => {
          if (!closed) controller?.enqueue(encoder.encode(": heartbeat\n\n"));
        }, 15_000);
        heartbeat.unref?.();
        input.request.signal.addEventListener("abort", close, { once: true });
        if (refreshQueued) void sendSnapshot();
      },
      cancel() { close(); },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}
