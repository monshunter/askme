import OpenAI from "openai";

import type { AiProfile } from "@/server/config";
import { AppError } from "@/server/errors";

export type { AiProfile } from "@/server/config";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionOptions = {
  jsonObject?: boolean;
  maxTokens?: number;
  temperature?: number;
};

type ClientConfig = {
  apiKey: string | null;
  baseUrl: string;
  profile: AiProfile;
};

type ClientOptions = {
  fetcher?: typeof fetch;
};

function stableProviderError(error: unknown, timedOut: boolean): AppError {
  if (timedOut) return new AppError("AI_TIMEOUT", "The AI provider did not respond in time.", 504);
  if (error instanceof OpenAI.AuthenticationError || (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403))) {
    return new AppError("AI_AUTH_FAILED", "The AI provider rejected the configured credentials.", 502);
  }
  if (error instanceof OpenAI.RateLimitError || (error instanceof OpenAI.APIError && error.status === 429)) {
    return new AppError("AI_RATE_LIMITED", "The AI provider is temporarily rate limited.", 503);
  }
  if (error instanceof OpenAI.APIError) {
    return new AppError("AI_UPSTREAM_FAILED", "The AI provider returned an error.", 502, { upstreamStatus: error.status });
  }
  return new AppError("AI_UNAVAILABLE", "The AI provider is unavailable.", 503);
}

export class OpenAiChatClient {
  private readonly client: OpenAI | null;

  constructor(private readonly config: ClientConfig, options: ClientOptions = {}) {
    this.client = config.apiKey
      ? new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl.replace(/\/+$/, ""),
          fetch: options.fetcher,
          maxRetries: config.profile.maxRetries,
          timeout: config.profile.timeoutMs,
        })
      : null;
  }

  async complete(messages: ChatMessage[], options: CompletionOptions = {}) {
    if (!this.client) {
      throw new AppError("AI_NOT_CONFIGURED", "The AI provider is not configured.", 503);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.profile.timeoutMs);
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.config.profile.model,
          messages,
          stream: false,
          ...(this.config.profile.thinking === "off" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: this.config.profile.thinking }),
          ...(options.jsonObject ? { response_format: { type: "json_object" } } : {}),
          max_tokens: Math.min(options.maxTokens ?? this.config.profile.maxTokens, this.config.profile.maxTokens),
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal: controller.signal, timeout: this.config.profile.timeoutMs, maxRetries: this.config.profile.maxRetries },
      );
      const content = completion.choices[0]?.message.content?.trim();
      if (!content) throw new AppError("AI_INVALID_RESPONSE", "The AI provider returned an invalid response.", 502);
      return {
        content,
        inputTokens: completion.usage?.prompt_tokens ?? null,
        outputTokens: completion.usage?.completion_tokens ?? null,
        model: completion.model,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw stableProviderError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
    }
  }
}
