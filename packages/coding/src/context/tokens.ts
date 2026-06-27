import type { AgentMessage, AgentTool } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_CONTEXT_WINDOW = 128000;
const PI_STYLE_RESERVE = 16384;

// ---------------------------------------------------------------------------
// estimateTextTokens
// ---------------------------------------------------------------------------

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// ---------------------------------------------------------------------------
// estimateMessageTokens
// ---------------------------------------------------------------------------

export function estimateMessageTokens(msg: AgentMessage): number {
  const overhead = 4;
  let tokens = overhead + estimateTextTokens(msg.content);

  if (msg.role === "assistant" && msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += 16 + estimateTextTokens(tc.name) + estimateTextTokens(JSON.stringify(tc.arguments));
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// estimateToolTokens
// ---------------------------------------------------------------------------

export function estimateToolTokens(tool: AgentTool): number {
  const overhead = 16;
  return overhead
    + estimateTextTokens(tool.name)
    + estimateTextTokens(tool.description)
    + estimateTextTokens(JSON.stringify(tool.inputSchema));
}

// ---------------------------------------------------------------------------
// ContextUsageEstimate
// ---------------------------------------------------------------------------

export interface ContextUsageEstimate {
  systemTokens: number;
  messageTokens: number;
  toolTokens: number;
  totalTokens: number;
  messageCount: number;
  toolCount: number;
}

export function estimateContextTokens(
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
): ContextUsageEstimate {
  const systemTokens = estimateTextTokens(system);
  let messageTokens = 0;
  for (const msg of messages) {
    messageTokens += estimateMessageTokens(msg);
  }
  let toolTokens = 0;
  for (const tool of tools) {
    toolTokens += estimateToolTokens(tool);
  }

  return {
    systemTokens,
    messageTokens,
    toolTokens,
    totalTokens: systemTokens + messageTokens + toolTokens,
    messageCount: messages.length,
    toolCount: tools.length,
  };
}

// ---------------------------------------------------------------------------
// autoCompactionThreshold
// ---------------------------------------------------------------------------

export function autoCompactionThreshold(contextWindowTokens: number): number | null {
  if (contextWindowTokens <= 0) return null;
  return Math.max(1, contextWindowTokens - PI_STYLE_RESERVE);
}
