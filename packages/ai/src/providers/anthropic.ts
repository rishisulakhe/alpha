import type { AgentMessage, AgentTool, ToolCall } from "@alpha/agent";
import type { CancellationToken, ModelProvider } from "../provider.ts";
import type { ProviderEvent } from "../events.ts";
import { withRetry } from "../retry.ts";
import { parseSseStream, safeJsonParse } from "./sse.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxRetryDelaySeconds?: number;
  thinkingBudgetTokens?: number;
  headers?: Record<string, string>;
}

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// AnthropicToolBuilder — accumulates tool use fragments
// ---------------------------------------------------------------------------

class AnthropicToolBuilder {
  id = "";
  name = "";
  argumentsParts: string[] = [];

  build(index: number): ToolCall {
    const argsText = this.argumentsParts.join("");
    const args = safeJsonParse(argsText) ?? { _rawArguments: argsText };
    return {
      id: this.id || `tool-call-${index}`,
      name: this.name,
      arguments: args as Record<string, unknown> as ToolCall["arguments"],
    };
  }
}

// ---------------------------------------------------------------------------
// Message & tool conversion
// ---------------------------------------------------------------------------

export function convertToAnthropicMessage(msg: AgentMessage): Record<string, unknown> {
  if (msg.role === "user") {
    return { role: "user", content: msg.content };
  }

  if (msg.role === "assistant") {
    const content: Array<Record<string, unknown>> = [];
    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }
    for (const tc of msg.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      });
    }
    return { role: "assistant", content };
  }

  if (msg.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content,
          is_error: !msg.ok,
        },
      ],
    };
  }

  throw new Error(`Unknown message role: ${(msg as { role: string }).role}`);
}

export function convertToAnthropicTools(tools: AgentTool[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements ModelProvider {
  constructor(private _config: AnthropicConfig) {}

  async *streamResponse(params: {
    model: string;
    system: string;
    messages: AgentMessage[];
    tools: AgentTool[];
    signal?: CancellationToken;
  }): AsyncIterable<ProviderEvent> {
    const payload = this._buildPayload(params);
    const baseUrl = this._config.baseUrl ?? DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/$/, "")}/messages`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "x-api-key": this._config.apiKey,
      ...(this._config.headers ?? {}),
    };

    if (this._config.maxRetries != null && this._config.maxRetries > 0) {
      const maxRetries = this._config.maxRetries;
      const maxDelay = this._config.maxRetryDelaySeconds ?? 30;
      const signal = params.signal;

      yield* withRetry({ maxRetries, maxDelaySeconds: maxDelay, signal }, () =>
        this._streamRequest(url, payload, headers, params.model, params.signal),
      );
    } else {
      yield* this._streamRequest(url, payload, headers, params.model, params.signal);
    }
  }

  private _buildPayload(params: {
    model: string;
    system: string;
    messages: AgentMessage[];
    tools: AgentTool[];
  }): string {
    let maxTokens = DEFAULT_MAX_TOKENS;
    if (this._config.thinkingBudgetTokens != null) {
      maxTokens = Math.max(maxTokens, this._config.thinkingBudgetTokens + 1024);
    }

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: maxTokens,
      stream: true,
      system: params.system,
      messages: params.messages.map(convertToAnthropicMessage),
    };

    if (this._config.thinkingBudgetTokens != null) {
      body.thinking = { type: "enabled", budget_tokens: this._config.thinkingBudgetTokens };
    }

    if (params.tools.length > 0) {
      body.tools = convertToAnthropicTools(params.tools);
    }

    return JSON.stringify(body);
  }

  private async *_streamRequest(
    url: string,
    payload: string,
    headers: Record<string, string>,
    model: string,
    signal?: CancellationToken,
  ): AsyncIterable<ProviderEvent> {
    const controller = new AbortController();
    const timeoutMs = (this._config.timeoutSeconds ?? 60) * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: payload, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const isTransient = response.status === 408 || response.status === 409 ||
        response.status === 429 || response.status === 500 ||
        response.status === 502 || response.status === 503 || response.status === 504;
      if (isTransient) {
        throw new Error(`HTTP ${response.status}${bodyText ? `: ${bodyText}` : ""}`);
      }
      yield {
        type: "error",
        message: `Provider request failed with status ${response.status}`,
        statusCode: response.status,
        recoverable: false,
      } satisfies ProviderEvent;
      return;
    }

    if (!response.body) {
      yield { type: "error", message: "No response body", recoverable: false } satisfies ProviderEvent;
      return;
    }

    yield { type: "response_start", model } satisfies ProviderEvent;

    const contentParts: string[] = [];
    const toolBuilders = new Map<number, AnthropicToolBuilder>();
    let finishReason: string | undefined;

    for await (const data of parseSseStream(response.body)) {
      if (signal?.isCancelled()) return;

      const chunk = safeJsonParse<Record<string, unknown>>(data);
      if (!chunk) continue;

      const eventType = chunk.type as string | undefined;

      if (eventType === "content_block_start") {
        const block = chunk.content_block as Record<string, unknown> | undefined;
        if (block && block.type === "tool_use") {
          const index = (chunk.index as number) ?? 0;
          const builder = new AnthropicToolBuilder();
          builder.id = (block.id as string) ?? "";
          builder.name = (block.name as string) ?? "";
          toolBuilders.set(index, builder);
        }
      } else if (eventType === "content_block_delta") {
        const delta = chunk.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        const deltaType = delta.type as string | undefined;
        if (deltaType === "text_delta") {
          const text = (delta.text as string) ?? "";
          if (text) {
            contentParts.push(text);
            yield { type: "text_delta", text } satisfies ProviderEvent;
          }
        } else if (deltaType === "thinking_delta") {
          const thinking = (delta.thinking as string) ?? "";
          if (thinking) {
            yield { type: "thinking_delta", text: thinking } satisfies ProviderEvent;
          }
        } else if (deltaType === "input_json_delta") {
          const index = (chunk.index as number) ?? 0;
          let builder = toolBuilders.get(index);
          if (!builder) {
            builder = new AnthropicToolBuilder();
            toolBuilders.set(index, builder);
          }
          builder.argumentsParts.push((delta.partial_json as string) ?? "");
        }
      } else if (eventType === "message_delta") {
        const delta = chunk.delta as Record<string, unknown> | undefined;
        if (delta) {
          finishReason = (delta.stop_reason as string) || finishReason;
        }
      } else if (eventType === "error") {
        const error = chunk.error as Record<string, unknown> | undefined;
        const message = (error?.message as string) ?? "Provider returned an error";
        yield { type: "error", message, recoverable: false } satisfies ProviderEvent;
        return;
      }
    }

    const toolCalls = [...toolBuilders.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, builder]) => builder.build(index));

    for (const tc of toolCalls) {
      yield { type: "tool_call", call: tc } satisfies ProviderEvent;
    }

    yield {
      type: "response_end",
      message: { role: "assistant", content: contentParts.join(""), tool_calls: toolCalls },
      finishReason: finishReason ?? "stop",
    } satisfies ProviderEvent;
  }
}
