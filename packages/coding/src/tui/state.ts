/**
 * TUI display state (similar to Tau's tui/state.py).
 *
 * Manages the mutable state for the interactive TUI.
 */

import type { ToolCall, AgentToolResult } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatItemRole =
  | "user"
  | "assistant"
  | "tool"
  | "error"
  | "status"
  | "thinking"
  | "skill";

export interface ChatItem {
  id: number;
  role: ChatItemRole;
  text: string;
  toolCallId?: string;
  toolName?: string;
  toolResultText?: string;
  alwaysShowToolResult?: boolean;
  collapsed?: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

let _nextId = 1;
function nextId(): number {
  return _nextId++;
}

export function formatToolCallBlock(call: ToolCall): string {
  const parsed = call.arguments;
  const providerValue = parsed.provider;
  if (typeof providerValue === "string") {
    return `${call.name}: provider=${providerValue}`;
  }
  // Show first arg if it exists
  const firstKey = Object.keys(parsed)[0];
  if (firstKey) {
    const firstValue = parsed[firstKey];
    if (typeof firstValue === "string") {
      if (firstValue.length > 40) {
        return `${call.name}: ${firstKey}=${firstValue.slice(0, 40)}…`;
      }
      return `${call.name}: ${firstKey}=${firstValue}`;
    }
  }
  return `${call.name}`;
}

export function formatToolResultBlock(result: AgentToolResult): string {
  const status = result.ok ? "✓" : "✗";
  let content = result.content.slice(0, 500);
  if (result.content.length > 500) {
    content += "…";
  }
  return `${status} ${result.name}\n${content}`;
}

// ---------------------------------------------------------------------------
// TuiState class
// ---------------------------------------------------------------------------

export class TuiState {
  items: ChatItem[] = [];
  assistantBuffer = "";
  running = false;
  error: string | null = null;
  showToolResults = false;
  showThinking = false;

  clear(): void {
    this.items = [];
    this.assistantBuffer = "";
    this.running = false;
    this.error = null;
  }

  addItem(
    role: ChatItemRole,
    text: string,
    options: {
      toolCallId?: string;
      toolName?: string;
      toolResultText?: string;
      alwaysShowToolResult?: boolean;
      collapsed?: boolean;
    } = {},
  ): void {
    this.items.push({
      id: nextId(),
      role,
      text,
      timestamp: Date.now(),
      ...options,
    });
  }

  addUserMessage(content: string): void {
    this.addItem("user", content);
  }

  addAssistantMessage(content: string): void {
    this.addItem("assistant", content);
  }

  addToolCall(call: ToolCall): void {
    this.addItem("tool", formatToolCallBlock(call), {
      toolCallId: call.id,
      toolName: call.name,
    });
  }

  addToolUpdate(message: string): void {
    this.addItem("tool", `… ${message}`);
  }

  recordToolResult(result: AgentToolResult): void {
    // Find the matching tool call item and update it
    const existingIndex = this.items.findIndex(
      (item) => item.role === "tool" && item.toolCallId === result.toolCallId,
    );

    if (existingIndex !== -1) {
      const existing = this.items[existingIndex]!;
      this.items[existingIndex] = {
        ...existing,
        text: formatToolResultBlock(result),
        toolResultText: result.content,
      };
    } else {
      // No matching tool call, add as new item
      this.addItem("tool", formatToolResultBlock(result), {
        toolName: result.name,
        toolResultText: result.content,
      });
    }
  }

  addThinkingDelta(delta: string): void {
    // Find last thinking item and append, or create new one
    const lastItem = this.items[this.items.length - 1];
    if (lastItem && lastItem.role === "thinking" && lastItem.collapsed) {
      lastItem.text += delta;
    } else {
      this.addItem("thinking", delta, { collapsed: true });
    }
  }

  flushAssistantBuffer(): void {
    if (this.assistantBuffer) {
      this.addAssistantMessage(this.assistantBuffer);
      this.assistantBuffer = "";
    }
  }

  addStatus(message: string): void {
    this.addItem("status", message);
  }

  addError(message: string): void {
    this.error = message;
    this.addItem("error", `Error: ${message}`);
  }

  toggleThinking(): boolean {
    this.showThinking = !this.showThinking;
    return this.showThinking;
  }

  toggleToolResults(): boolean {
    this.showToolResults = !this.showToolResults;
    return this.showToolResults;
  }
}
