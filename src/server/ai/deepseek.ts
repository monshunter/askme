import { AppError } from "@/server/errors";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekConfig = {
  apiKey: string | null;
  baseUrl: string;
  model: string;
};

type ClientOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type CompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class DeepSeekClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: DeepSeekConfig, options: ClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async complete(messages: ChatMessage[]) {
    if (!this.config.apiKey) {
      throw new AppError("AI_NOT_CONFIGURED", "The AI provider is not configured.", 503);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(`${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          thinking: { type: "disabled" },
          stream: false,
        }),
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new AppError("AI_AUTH_FAILED", "The AI provider rejected the configured credentials.", 502);
      }
      if (response.status === 429) {
        throw new AppError("AI_RATE_LIMITED", "The AI provider is temporarily rate limited.", 503);
      }
      if (!response.ok) {
        throw new AppError("AI_UPSTREAM_FAILED", "The AI provider returned an error.", 502, { upstreamStatus: response.status });
      }

      const payload = (await response.json()) as CompletionResponse;
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new AppError("AI_INVALID_RESPONSE", "The AI provider returned an invalid response.", 502);
      }

      return {
        content,
        inputTokens: payload.usage?.prompt_tokens ?? null,
        outputTokens: payload.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AppError("AI_TIMEOUT", "The AI provider did not respond in time.", 504);
      }
      throw new AppError("AI_UNAVAILABLE", "The AI provider is unavailable.", 503);
    } finally {
      clearTimeout(timeout);
    }
  }
}
