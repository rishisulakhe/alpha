/**
 * Event adapter for TUI (similar to Tau's tui/adapter.py).
 *
 * Translates agent events into TUI display state updates.
 */

import type { AgentEvent } from "@alpha/agent";
import type { TuiState } from "./state.ts";

/**
 * Adapter that applies agent events to TUI state.
 */
export class TuiEventAdapter {
  constructor(private state: TuiState) {}

  /**
   * Apply one agent event to the display state.
   */
  apply(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.state.running = true;
        this.state.error = null;
        break;

      case "agent_end":
        this.state.flushAssistantBuffer();
        this.state.running = false;
        break;

      case "message_start":
        if (event.role === "assistant") {
          this.state.assistantBuffer = "";
        }
        break;

      case "message_delta":
        this.state.assistantBuffer += event.text;
        break;

      case "thinking_delta":
        this.state.addThinkingDelta(event.text);
        break;

      case "message_end": {
        const message = event.message;
        if (message.role === "user") {
          this.state.addUserMessage(message.content);
        } else if (message.role === "assistant") {
          // Tool calls are handled by tool_execution_start
          // Only add text content here
          if (!message.tool_calls || message.tool_calls.length === 0) {
            const text = message.content || this.state.assistantBuffer;
            if (text) {
              this.state.addAssistantMessage(text);
            }
          }
          this.state.assistantBuffer = "";
        } else if (message.role === "tool") {
          // Tool messages are handled by tool_execution_end
        }
        break;
      }

      case "tool_execution_start":
        this.state.flushAssistantBuffer();
        if (event.call) {
          this.state.addToolCall(event.call);
        }
        break;

      case "tool_execution_update":
        this.state.addToolUpdate(event.message);
        break;

      case "tool_execution_end":
        this.state.recordToolResult(event.result);
        break;

      case "retry":
        this.state.addStatus(`Retrying: ${event.message}`);
        break;

      case "error": {
        this.state.flushAssistantBuffer();
        if (event.recoverable && event.message === "Agent run cancelled") {
          this.state.addStatus("Agent run cancelled.");
        } else {
          this.state.addError(event.message);
          if (!event.recoverable) {
            this.state.running = false;
          }
        }
        break;
      }
    }
  }
}
