import type { JSONObject } from "./types/json.ts";

// ---------------------------------------------------------------------------
// Re-export ToolCall from messages (single source of truth)
// ---------------------------------------------------------------------------

export { type ToolCall, ToolCallSchema } from "./messages.ts";

// ---------------------------------------------------------------------------
// CancellationToken — minimal interface for cooperative cancellation
// ---------------------------------------------------------------------------

export interface CancellationToken {
  isCancelled(): boolean;
}

// ---------------------------------------------------------------------------
// SimpleCancellationToken — concrete implementation for tests and harness
// ---------------------------------------------------------------------------

export class SimpleCancellationToken implements CancellationToken {
  private _cancelled = false;

  isCancelled(): boolean {
    return this._cancelled;
  }

  cancel(): void {
    this._cancelled = true;
  }
}

// ---------------------------------------------------------------------------
// AgentToolResult — structured result returned by a tool execution
// ---------------------------------------------------------------------------

export interface AgentToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  content: string;
  data?: JSONObject;
  details?: JSONObject;
  error?: string;
}

// ---------------------------------------------------------------------------
// AgentTool — definition of a tool exposed to the agent loop
// ---------------------------------------------------------------------------

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema describing the tool's parameters. */
  inputSchema: JSONObject;
  /** Execute the tool with provider-neutral JSON-like arguments. */
  execute(
    args: JSONObject,
    signal?: CancellationToken,
  ): Promise<AgentToolResult>;
  /** Short description shown in the system prompt's "Available tools" section. */
  promptSnippet?: string;
  /** Usage guidelines shown in the system prompt. */
  promptGuidelines?: string;
}
