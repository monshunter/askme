import { afterEach, describe, expect, it, vi } from "vitest";

import { startWorkerHeartbeat } from "./worker-heartbeat";

describe("startWorkerHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps refreshing independently of the worker processing loop until stopped", async () => {
    vi.useFakeTimers();
    const pulse = vi.fn().mockResolvedValue(undefined);
    const stop = await startWorkerHeartbeat(pulse, { intervalMs: 10_000 });

    expect(pulse).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pulse).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pulse).toHaveBeenCalledTimes(4);
  });

  it("reports a failed pulse and continues scheduling later heartbeats", async () => {
    vi.useFakeTimers();
    const failure = new Error("database unavailable");
    const pulse = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = await startWorkerHeartbeat(pulse, { intervalMs: 10_000, onError });

    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pulse).toHaveBeenCalledTimes(2);
    stop();
  });
});
