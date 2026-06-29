import type { AgentMessage, AgentTool, ToolCall } from "@alpha/agent";
import type { CancellationToken, ModelProvider } from "../provider.ts";
import type { ProviderEvent } from "../events.ts";
import { withRetry } from "../retry.ts";
import { parseSseStream, safeJsonParse } from "./sse.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OpenAICompatibleConfig {
  apiKey: string;
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutSeconds?: number;
  maxRetries?: number;
  maxRetryDelaySeconds?: number;
  reasoningEffort?: string;
  reasoningEffortParameter?: string;
}

// ---------------------------------------------------------------------------
// ToolCall — accumulator for streaming tool call fragments
// ---------------------------------------------------------------------------

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

class ToolCallBuilder {
  id = "";
  name = "";
  private _argumentsParts: string[] = [];

  addDelta(delta: ToolCallDelta): void {
    if (typeof delta.id === "string") this.id = delta.id;
    if (delta.function) {
      if (typeof delta.function.name === "string") this.name = delta.function.name;
      if (typeof delta.function.arguments === "string") {
        this._argumentsParts.push(delta.function.arguments);
      }
    }
  }

  build(index: number): ToolCall {
    const argsText = this._argumentsParts.join("");
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

function systemMessage(system: string) {
  return { role: "system", content: system } as const;
}

export function convertToOpenAIMessage(msg: AgentMessage): Record<string, unknown> {
  if (msg.role === "user") return { role: "user", content: msg.content };

  if (msg.role === "assistant") {
    const item: Record<string, unknown> = { role: "assistant", content: msg.content };
    if (msg.tool_calls.length > 0) {
      item.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    return item;
  }

  if (msg.role === "tool") {
    return {
      role: "tool",
      tool_call_id: msg.tool_call_id,
      name: msg.name,
      content: msg.content,
    };
  }

  throw new Error(`Unknown message role: ${(msg as { role: string }).role}`);
}

export function convertTools(tools: AgentTool[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements ModelProvider {
  constructor(private _config: OpenAICompatibleConfig) {}

  async *streamResponse(params: {
    model: string;
    system: string;
    messages: AgentMessage[];
    tools: AgentTool[];
    signal?: CancellationToken;
  }): AsyncIterable<ProviderEvent> {
    const payload = this._buildPayload(params);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this._config.apiKey}`,
      ...(this._config.headers ?? {}),
    };
    const url = `${this._config.baseUrl.replace(/\/$/, "")}/chat/completions`;

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
    const body: Record<string, unknown> = {
      model: params.model,
      stream: true,
      messages: [systemMessage(params.system), ...params.messages.map(convertToOpenAIMessage)],
    };

    if (this._config.reasoningEffort != null) {
      if (this._config.reasoningEffortParameter === "reasoning.effort") {
        body.reasoning = { effort: this._config.reasoningEffort };
      } else {
        body.reasoning_effort = this._config.reasoningEffort;
      }
    }

    if (params.tools.length > 0) {
      body.tools = convertTools(params.tools);
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
    const onCancel = () => controller.abort();
    signal?.isCancelled() ? controller.abort() : null;

    const timeoutMs = (this._config.timeoutSeconds ?? 60) * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: payload, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const isTransient = response.status === 408 || response.status === 409 ||
        response.status === 425 || response.status === 429 || response.status >= 500;
      if (isTransient) {
        throw new Error(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
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
    const toolCallBuilders = new Map<number, ToolCallBuilder>();
    let finishReason: string | undefined;

    for await (const data of parseSseStream(response.body)) {
      if (signal?.isCancelled()) return;

      const chunk = safeJsonParse<Record<string, unknown>>(data);
      if (!chunk) continue;

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) continue;

      const choice = choices[0]!;
      finishReason = (choice.finish_reason as string) || finishReason;

      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      const content = delta.content;
      if (typeof content === "string" && content) {
        // Store raw content; strip tool-call markers from streamed text for clean display
        contentParts.push(content);
        const display = _stripInlineToolCalls(content);
        if (display) {
          yield { type: "text_delta", text: display } satisfies ProviderEvent;
        }
      }

      const thinking = _thinkingDeltaText(delta);
      if (thinking) {
        yield { type: "thinking_delta", text: thinking } satisfies ProviderEvent;
      }

      const toolCallDeltas = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCallDeltas) {
        for (const tcDelta of toolCallDeltas) {
          const index = (tcDelta.index as number) ?? 0;
          let builder = toolCallBuilders.get(index);
          if (!builder) {
            builder = new ToolCallBuilder();
            toolCallBuilders.set(index, builder);
          }
          builder.addDelta(tcDelta as unknown as ToolCallDelta);
        }
      }
    }

    const toolCalls = [...toolCallBuilders.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, builder]) => builder.build(index));

    for (const tc of toolCalls) {
      yield { type: "tool_call", call: tc } satisfies ProviderEvent;
    }

    yield {
      type: "response_end",
      message: { role: "assistant", content: _stripFullToolCalls(contentParts.join("")), tool_calls: toolCalls },
      finishReason: finishReason ?? "stop",
    } satisfies ProviderEvent;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _thinkingDeltaText(delta: Record<string, unknown>): string {
  for (const field of ["reasoning_content", "reasoning", "thinking"]) {
    const value = delta[field];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function _stripTextToolCalls(text: string): string {
  return text
    .replace(/<\|tool_call\|>[\s\S]*?<\|tool_call\|>/g, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
}

/** Strip full tool-call blocks from the assembled message text. */
function _stripFullToolCalls(text: string): string {
  return text
    // <|tool_call|>...</|tool_call|>
    .replace(/<\|tool_call\|>[\s\S]*?<\|tool_call\|>/g, "")
    // <|tool_call>...</tool_call|>  (Gemini free model format)
    .replace(/<\|tool_call>[\s\S]*?<tool_call\|>/g, "")
    // <tool_call>...</tool_call>
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .trim();
}

/** Strip tool-call marker fragments from individual streaming chunks. */
function _stripInlineToolCalls(text: string): string {
  // If the chunk starts with a tool call opening marker, hide it
  if (/^<[/\|]?tool_call[\|>]/.test(text)) return "";
  // Strip closing tool call markers from the end of a chunk
  return text.replace(/<\/?\|?tool_call\|?>$/, "").trim();
}
