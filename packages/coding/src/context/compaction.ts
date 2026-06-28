import type { AgentMessage } from "@alpha/agent";
import type { ContextUsageEstimate } from "./tokens.ts";
import { estimateMessageTokens } from "./tokens.ts";

// ---------------------------------------------------------------------------
// summarizeMessagesForCompaction — deterministic fallback
// ---------------------------------------------------------------------------

export function summarizeMessagesForCompaction(messages: AgentMessage[]): string {
  const lines = [`Automatically compacted ${messages.length} prior message(s):`];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const role = msg.role[0]!.toUpperCase() + msg.role.slice(1);
    const truncated = msg.content.length > 200 ? msg.content.slice(0, 200) + "..." : msg.content;
    lines.push(`${i + 1}. [${role}]: ${truncated || "(empty)"}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// serializeMessagesForCompaction
// ---------------------------------------------------------------------------

export function serializeMessagesForCompaction(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    lines.push(`<message role="${msg.role}">`);
    lines.push(msg.content);
    if (msg.role === "assistant" && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        lines.push(`  <tool_call name="${tc.name}" args="${_escapeXml(JSON.stringify(tc.arguments))}" />`);
      }
    } else if (msg.role === "tool") {
      lines.push(`  <tool_result ok="${msg.ok}" />`);
    }
    lines.push(`</message>`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// buildCompactionPrompt
// ---------------------------------------------------------------------------

export function buildCompactionPrompt(
  messages: AgentMessage[],
  customInstructions?: string,
): string {
  const serialized = serializeMessagesForCompaction(messages);
  const instructions = customInstructions
    ? `\nFocus areas: ${customInstructions}\n`
    : "";

  return `<conversation>
${serialized}
</conversation>

Summarize the above conversation in this format:
${instructions}
## Goal
## Constraints
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context

Preserve file paths mentioned in the conversation.`;
}

// ---------------------------------------------------------------------------
// buildUpdateCompactionPrompt
// ---------------------------------------------------------------------------

export function buildUpdateCompactionPrompt(
  previousSummary: string,
  newMessages: AgentMessage[],
  customInstructions?: string,
): string {
  const serialized = serializeMessagesForCompaction(newMessages);
  const instructions = customInstructions
    ? `\nFocus areas: ${customInstructions}\n`
    : "";

  return `<previous-summary>
${previousSummary}
</previous-summary>

<conversation>
${serialized}
</conversation>

Update the summary above to incorporate the NEW conversation messages.
${instructions}
Maintain the same format:
## Goal
## Constraints
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context`;
}

// ---------------------------------------------------------------------------
// recentPreservingCompactionPlan
// ---------------------------------------------------------------------------

export interface CompactionPlan {
  keep: AgentMessage[];
  compact: AgentMessage[];
}

export function recentPreservingCompactionPlan(
  messages: AgentMessage[],
  keepTokens: number = 20000,
): CompactionPlan {
  let running = 0;
  const keep: AgentMessage[] = [];
  const compact: AgentMessage[] = [];

  // Iterate from newest to oldest, keeping recent until we exceed the token budget
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const tokens = estimateMessageTokens(msg);
    if (running + tokens <= keepTokens) {
      running += tokens;
      keep.unshift(msg);
    } else {
      compact.unshift(msg);
    }
  }

  return { keep, compact };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
