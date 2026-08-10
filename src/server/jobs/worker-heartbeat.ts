export type WorkerHeartbeatOptions = {
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

export async function startWorkerHeartbeat(pulse: () => Promise<void>, options: WorkerHeartbeatOptions = {}) {
  const intervalMs = options.intervalMs ?? 10_000;
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) throw new Error("The worker heartbeat interval must be at least one second.");

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const beat = async () => {
    try {
      await pulse();
    } catch (error) {
      options.onError?.(error);
    }
    if (stopped) return;
    timer = setTimeout(() => void beat(), intervalMs);
    timer.unref();
  };

  await beat();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
