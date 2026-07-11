import type { AgentEvent, ToolCall, AgentToolResult } from "@alpha/agent";
import type { ChatItem, ChatRole } from "../types.ts";

let _nextId = 0;

export class TranscriptState {
  items: ChatItem[] = [];
  assistantBuffer = "";
  thinkingBuffer = "";
  running = false;
  error: string | null = null;
  showThinking = true;
  showToolResults = false;

  get totalLines(): number {
    return this.items.length;
  }

  addItem(role: ChatRole, text: string, opts?: Partial<ChatItem>): void {
    this.items.push({
      id: ++_nextId,
      role,
      text,
      streaming: true,
      ...opts,
      timestamp: Date.now(),
    } as ChatItem);
  }

  addUserMessage(content: string): void {
    this.addItem("user", content, { streaming: false });
  }

  addAssistantMessage(content: string): void {
    this.addItem("assistant", content, { streaming: false });
  }

  addToolCall(call: ToolCall): void {
    const name = call.name;
    const args = call.arguments as Record<string, unknown>;
    const filePath = typeof args.filePath === "string" ? args.filePath : "";
    const command = typeof args.command === "string" ? args.command : "";
    const preview = filePath || command || "";
    this.addItem("tool", `→ ${name} ${preview}`.trim(), {
      toolName: name,
    });
  }

  recordToolResult(result: AgentToolResult): void {
    const glyph = result.ok ? "✓" : "✗";
    const text = `${glyph} ${result.name}\n${result.content.slice(0, 300)}`;
    this.items.push({
      id: ++_nextId,
      role: "tool",
      text,
      toolName: result.name,
      toolOk: result.ok,
      toolResultText: result.content,
      streaming: false,
      timestamp: Date.now(),
    } as ChatItem);
  }

  appendThinkingDelta(delta: string): void {
    const last = this.items[this.items.length - 1];
    if (last?.role === "thinking" && last.streaming) {
      last.text += delta;
    } else {
      this.addItem("thinking", delta);
    }
  }

  finalizeThinking(): void {
    const last = this.items[this.items.length - 1];
    if (last?.role === "thinking" && last.streaming) {
      last.streaming = false;
    }
  }

  addStatus(message: string): void {
    this.addItem("status", message, { streaming: false });
  }

  addError(message: string): void {
    this.error = message;
    this.addItem("error", `Error: ${message}`, { streaming: false });
  }

  clear(): void {
    this.items = [];
    this.assistantBuffer = "";
    this.thinkingBuffer = "";
    this.running = false;
    this.error = null;
  }
}

export function applyEvent(state: TranscriptState, event: AgentEvent): void {
  switch (event.type) {
    case "agent_start":
      state.running = true;
      state.error = null;
      break;

    case "agent_end":
      if (state.assistantBuffer) {
        state.addAssistantMessage(state.assistantBuffer);
        state.assistantBuffer = "";
      }
      if (state.thinkingBuffer) {
        state.finalizeThinking();
        state.thinkingBuffer = "";
      }
      state.running = false;
      break;

    case "message_start":
      if (event.role === "assistant") {
        state.assistantBuffer = "";
        state.thinkingBuffer = "";
      }
      break;

    case "message_delta":
      state.assistantBuffer += event.text;
      break;

    case "thinking_delta":
      state.thinkingBuffer += event.text;
      state.appendThinkingDelta(event.text);
      break;

    case "message_end": {
      const msg = event.message;
      if (msg.role === "user") {
        state.addUserMessage(msg.content);
      } else if (msg.role === "assistant") {
        state.finalizeThinking();
        const content = msg.content || state.assistantBuffer;
        if (content) {
          state.addAssistantMessage(content);
        }
        state.assistantBuffer = "";
      }
      break;
    }

    case "tool_execution_start":
      if (state.assistantBuffer) {
        state.addAssistantMessage(state.assistantBuffer);
        state.assistantBuffer = "";
      }
      if (event.call) {
        state.addToolCall(event.call);
      }
      break;

    case "tool_execution_end":
      state.recordToolResult(event.result);
      break;

    case "retry":
      state.addStatus(`Retrying: ${event.message}`);
      break;

    case "error": {
      if (state.assistantBuffer) {
        state.addAssistantMessage(state.assistantBuffer);
        state.assistantBuffer = "";
      }
      if (event.recoverable && event.message === "Agent run cancelled") {
        state.addStatus("Agent run cancelled.");
      } else {
        state.addError(event.message);
        if (!event.recoverable) {
          state.running = false;
        }
      }
      break;
    }

    case "turn_start":
    case "turn_end":
    case "queue_update":
      break;
  }
}
