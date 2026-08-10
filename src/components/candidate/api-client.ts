export type ApiClientErrorKind = "network" | "invalid_response";

export class ApiClientError extends Error {
  constructor(readonly kind: ApiClientErrorKind) {
    super(kind === "network" ? "The API request could not be completed." : "The API returned an invalid response.");
    this.name = "ApiClientError";
  }
}

export async function requestApi<T>(input: RequestInfo | URL, init?: RequestInit, fetcher: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch {
    throw new ApiClientError("network");
  }

  try {
    return { response, payload: (await response.json()) as T };
  } catch {
    throw new ApiClientError("invalid_response");
  }
}
