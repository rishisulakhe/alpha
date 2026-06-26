import type { AgentMessage, AgentTool } from "@alpha/agent";
import type { ProviderEvent } from "./events.ts";

// ---------------------------------------------------------------------------
// CancellationToken — compatible with the agent's version
// ---------------------------------------------------------------------------

export interface CancellationToken {
  isCancelled(): boolean;
}

// ---------------------------------------------------------------------------
// ModelProvider — provider-neutral interface for streaming model responses
// ---------------------------------------------------------------------------

export interface ModelProvider {
  streamResponse(params: {
    model: string;
    system: string;
    messages: AgentMessage[];
    tools: AgentTool[];
    signal?: CancellationToken;
  }): AsyncIterable<ProviderEvent>;
}
