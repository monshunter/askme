import os from "node:os";

import { Client } from "pg";

const HEARTBEAT_INTERVAL_MS = 10_000;
const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

async function heartbeat(client: Client) {
  await client.query(
    `INSERT INTO worker_heartbeats(worker_id, version, last_seen_at)
     VALUES ($1, $2, now())
     ON CONFLICT (worker_id) DO UPDATE SET version = excluded.version, last_seen_at = excluded.last_seen_at`,
    [workerId, process.env.npm_package_version ?? "0.1.0"],
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString });
  await client.connect();
  console.info(JSON.stringify({ event: "worker.started", workerId }));

  try {
    while (!stopping) {
      await heartbeat(client);
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL_MS));
    }
  } finally {
    await client.end();
    console.info(JSON.stringify({ event: "worker.stopped", workerId }));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  console.error(JSON.stringify({ event: "worker.failed", workerId, message }));
  process.exitCode = 1;
});
