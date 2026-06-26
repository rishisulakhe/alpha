import type { AgentMessage, AgentTool } from "@alpha/agent";
import type { ToolCall } from "@alpha/agent";
import type { ProviderEvent } from "./events.ts";
import type { CancellationToken, ModelProvider } from "./provider.ts";

// ---------------------------------------------------------------------------
// Recorded call shape
// ---------------------------------------------------------------------------

export interface FakeProviderCall {
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
}

// ---------------------------------------------------------------------------
// FakeProvider — deterministic test provider
// ---------------------------------------------------------------------------

export class FakeProvider implements ModelProvider {
  private _streams: ProviderEvent[][];
  readonly calls: FakeProviderCall[] = [];

  constructor(streams: ProviderEvent[][] = []) {
    this._streams = streams.map((s) => [...s]);
  }

  // -- ModelProvider implementation ------------------------------------------

  async *streamResponse(params: {
    model: string;
    system: string;
    messages: AgentMessage[];
    tools: AgentTool[];
    signal?: CancellationToken;
  }): AsyncIterable<ProviderEvent> {
    this.calls.push({
      model: params.model,
      system: params.system,
      messages: [...params.messages],
      tools: [...params.tools],
    });

    const stream = this._streams.shift() ?? [];

    for (const event of stream) {
      if (params.signal?.isCancelled()) return;
      yield event;
    }
  }

  // -- Convenience builders (static factories) --------------------------------

  /** Create a FakeProvider that returns a single text response in one turn. */
  static singleTextResponse(
    content: string,
    opts?: { model?: string; finishReason?: string },
  ): FakeProvider {
    const model = opts?.model ?? "fake";
    const finishReason = opts?.finishReason ?? "stop";
    return new FakeProvider([
      [
        { type: "response_start", model },
        { type: "text_delta", text: content },
        {
          type: "response_end",
          message: { role: "assistant", content, tool_calls: [] },
          finishReason,
        },
      ],
    ]);
  }

  /** Create a FakeProvider that returns tool calls in the first turn, then a text response in the second. */
  static singleToolCallResponse(
    calls: ToolCall[],
    opts?: {
      model?: string;
      finalContent?: string;
    },
  ): FakeProvider {
    const model = opts?.model ?? "fake";
    const finalContent = opts?.finalContent ?? "Done.";
    return new FakeProvider([
      [
        { type: "response_start", model },
        ...calls.map(
          (call): ProviderEvent => ({ type: "tool_call", call }),
        ),
        {
          type: "response_end",
          message: {
            role: "assistant",
            content: "",
            tool_calls: calls,
          },
          finishReason: "tool_use",
        },
      ],
      [
        { type: "response_start", model },
        { type: "text_delta", text: finalContent },
        {
          type: "response_end",
          message: { role: "assistant", content: finalContent, tool_calls: [] },
          finishReason: "stop",
        },
      ],
    ]);
  }

  /** Create a FakeProvider with a custom multi-turn script. */
  static fromScript(streams: ProviderEvent[][]): FakeProvider {
    return new FakeProvider(streams);
  }
}
