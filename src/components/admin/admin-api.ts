export type AdminApiEnvelope<T> = { data: T | null; error: { code: string; message: string } | null; requestId?: string };

export async function adminRequest<T>(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error("The Admin API connection failed. Try again.");
  }
  let payload: AdminApiEnvelope<T>;
  try {
    payload = await response.json() as AdminApiEnvelope<T>;
  } catch {
    throw new Error("The Admin API returned an invalid response.");
  }
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "The Admin request failed.");
  return payload.data;
}
