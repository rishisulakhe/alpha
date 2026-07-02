/**
 * Minimal TUI implementation for Alpha coding agent.
 *
 * Uses direct ANSI output with differential rendering,
 * matching Pi's approach (not React/Ink).
 *
 * Features:
 * - Streaming message display
 * - Tool call status boxes
 * - Scrolling transcript
 * - Real-time updates
 */

import * as process from "node:process";
import { InMemorySessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "../session.ts";
import { createProvider } from "../provider.ts";
import type { AgentEvent, ToolCall, AgentToolResult } from "@alpha/agent";

// ---------------------------------------------------------------------------
// ANSI Utilities
// ---------------------------------------------------------------------------

const ESC = "\x1b[";
const CURSOR_TO_BOTTOM = `${ESC}9999;1H`;
const CLEAR_LINE = `${ESC}2K`;
const SHOW_CURSOR = `${ESC}?25h`;
const HIDE_CURSOR = `${ESC}?25l`;
const RESET = "\x1b[0m";

function fg(color: number | string, text: string): string {
  if (typeof color === "number") {
    return `${ESC}38;5;${color}m${text}${RESET}`;
  }
  return `${ESC}38;5;${color}m${text}${RESET}`;
}

function dim(text: string): string {
  return `${ESC}2m${text}${RESET}`;
}

function bold(text: string): string {
  return `${ESC}1m${text}${RESET}`;
}

function green(text: string): string {
  return fg(2, text);
}

function cyan(text: string): string {
  return fg(6, text);
}

function yellow(text: string): string {
  return fg(3, text);
}

function red(text: string): string {
  return fg(1, text);
}

function magenta(text: string): string {
  return fg(5, text);
}

function truncate(str: string, width: number): string {
  // Handle ANSI codes properly
  let visibleLen = 0;
  let result = "";
  let inEscape = false;

  for (let i = 0; i < str.length && visibleLen < width; i++) {
    const char = str[i]!;
    if (char === "\x1b") {
      inEscape = true;
      result += char;
    } else if (inEscape) {
      result += char;
      if (char === "m") inEscape = false;
    } else {
      result += char;
      visibleLen++;
    }
  }

  if (visibleLen >= width) {
    return result + RESET;
  }
  return result;
}

function repeat(char: string, count: number): string {
  return char.repeat(Math.max(0, count));
}

// ---------------------------------------------------------------------------
// Terminal Helpers
// ---------------------------------------------------------------------------

function getTermSize(): { width: number; height: number } {
  return {
    width: process.stdout.columns ?? 80,
    height: process.stdout.rows ?? 24,
  };
}

function clearScreen(): void {
  process.stdout.write(`${ESC}2J${ESC}H`);
}

function moveTo(row: number, col: number): void {
  process.stdout.write(`${ESC}${row};${col}H`);
}

// ---------------------------------------------------------------------------
// Chat Item Types
// ---------------------------------------------------------------------------

type ChatItemRole = "user" | "assistant" | "tool" | "thinking" | "error" | "status";

interface ChatItem {
  id: number;
  role: ChatItemRole;
  text: string;
  toolName?: string;
  toolOk?: boolean;
}

// ---------------------------------------------------------------------------
// TUI State
// ---------------------------------------------------------------------------

class TuiState {
  items: ChatItem[] = [];
  assistantBuffer = "";
  running = false;
  input = "";
  provider = "demo";
  model = "loading...";
  tokens = 0;

  private _nextId = 1;
  scrollOffset = 0; // public for rendering

  addItem(role: ChatItemRole, text: string, opts: { toolName?: string; toolOk?: boolean } = {}): void {
    this.items.push({
      id: this._nextId++,
      role,
      text,
      ...opts,
    });
    // Auto-scroll to bottom
    const termHeight = getTermSize().height;
    const maxVisible = termHeight - 8; // Reserve for header, input, status
    this.scrollOffset = Math.max(0, this.items.length - maxVisible);
  }

  clear(): void {
    this.items = [];
    this.assistantBuffer = "";
    this.scrollOffset = 0;
  }

  scrollUp(): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset--;
    }
  }

  scrollDown(): void {
    const termHeight = getTermSize().height;
    const maxVisible = termHeight - 8;
    const maxOffset = Math.max(0, this.items.length - maxVisible);
    if (this.scrollOffset < maxOffset) {
      this.scrollOffset++;
    }
  }

  getVisibleItems(termHeight: number): ChatItem[] {
    const maxVisible = Math.max(1, termHeight - 8);
    return this.items.slice(this.scrollOffset, this.scrollOffset + maxVisible);
  }

  formatToolCall(call: ToolCall): string {
    const args = call.arguments as Record<string, unknown>;
    const firstKey = Object.keys(args)[0];
    if (firstKey && typeof args[firstKey] === "string") {
      const val = args[firstKey] as string;
      return `${call.name}: ${firstKey}=${val.slice(0, 40)}${val.length > 40 ? "…" : ""}`;
    }
    return call.name;
  }

  formatToolResult(result: AgentToolResult): string {
    const status = result.ok ? green("✓") : red("✗");
    const content = result.content.slice(0, 100).replace(/\n/g, " ");
    return `${status} ${result.name}: ${content}${result.content.length > 100 ? "…" : ""}`;
  }
}

// ---------------------------------------------------------------------------
// Event Adapter
// ---------------------------------------------------------------------------

class EventAdapter {
  constructor(private state: TuiState) {}

  apply(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.state.running = true;
        break;

      case "agent_end":
        if (this.state.assistantBuffer) {
          this.state.addItem("assistant", this.state.assistantBuffer);
          this.state.assistantBuffer = "";
        }
        this.state.running = false;
        break;

      case "thinking_delta":
        // Accumulate thinking - show as collapsed block
        const lastItem = this.state.items[this.state.items.length - 1];
        if (lastItem?.role === "thinking" && lastItem.text.length < 200) {
          lastItem.text += event.text;
        } else {
          this.state.addItem("thinking", event.text);
        }
        break;

      case "message_delta":
        this.state.assistantBuffer += event.text;
        break;

      case "message_end": {
        const msg = event.message;
        if (msg.role === "user") {
          this.state.addItem("user", msg.content);
        } else if (msg.role === "assistant" && !msg.tool_calls?.length) {
          if (this.state.assistantBuffer || msg.content) {
            this.state.addItem("assistant", msg.content || this.state.assistantBuffer);
            this.state.assistantBuffer = "";
          }
        }
        break;
      }

      case "tool_execution_start":
        if (event.call) {
          this.state.addItem("tool", this.state.formatToolCall(event.call), {
            toolName: event.call.name,
          });
        }
        break;

      case "tool_execution_end":
        // Update last tool item with result
        const lastTool = this.state.items[this.state.items.length - 1];
        if (lastTool?.role === "tool" && lastTool.toolName === event.result.name) {
          lastTool.text = this.state.formatToolResult(event.result);
          lastTool.toolOk = event.result.ok;
        } else {
          this.state.addItem("tool", this.state.formatToolResult(event.result), {
            toolName: event.result.name,
            toolOk: event.result.ok,
          });
        }
        break;

      case "retry":
        this.state.addItem("status", `Retrying: ${event.message}`);
        break;

      case "error":
        this.state.addItem("error", `Error: ${event.message}`);
        if (!event.recoverable) {
          this.state.running = false;
        }
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function renderTui(state: TuiState): string {
  const { width, height } = getTermSize();
  const lines: string[] = [];

  // Header: status line
  const headerLine = `${cyan("α")} ${dim(state.provider)}:${state.model} ${dim("│")} tokens: ~${state.tokens}`;
  lines.push(truncate(headerLine, width));

  // Divider
  lines.push(dim(repeat("─", width - 1)));

  // Chat items
  const visibleItems = state.getVisibleItems(height);
  const maxItems = height - 8; // Reserve for header, dividers, input, footer

  // Scroll indicator
  if (state.scrollOffset > 0) {
    lines.push(dim(`↑ ${state.scrollOffset} more above`));
  }

  for (const item of visibleItems.slice(0, maxItems)) {
    switch (item.role) {
      case "user":
        lines.push(`${cyan("❯")} ${item.text}`);
        break;
      case "assistant":
        lines.push(`${green("❮")} ${item.text.slice(0, 500)}`);
        break;
      case "thinking":
        lines.push(`${magenta("💭")} ${dim(item.text.slice(0, 150))}${item.text.length > 150 ? "…" : ""}`);
        break;
      case "tool":
        lines.push(`${yellow("⚙")} ${item.text}`);
        break;
      case "error":
        lines.push(`${red("✗")} ${item.text}`);
        break;
      case "status":
        lines.push(dim(`• ${item.text}`));
        break;
    }
  }

  // Show streaming buffer
  if (state.assistantBuffer) {
    lines.push(`${green("❮")} ${state.assistantBuffer.slice(-200)}`);
  }

  // Scroll indicator below
  const totalItems = state.items.length;
  const itemsBelow = totalItems - state.scrollOffset - maxItems;
  if (itemsBelow > 0) {
    lines.push(dim(`↓ ${itemsBelow} more below`));
  }

  // Pad to fill space
  while (lines.length < height - 4) {
    lines.push("");
  }

  // Divider
  lines.push(dim(repeat("─", width - 1)));

  // Input line
  const promptSymbol = state.running ? yellow("⏳") : cyan("❯");
  const inputLine = `${promptSymbol} ${state.input}${state.running ? "" : "█"}`;
  lines.push(truncate(inputLine, width));

  // Footer
  const footerLine = state.running
    ? yellow("Working... (Esc to cancel, Ctrl+D to quit)")
    : dim("Enter to submit │ PgUp/PgDn or ↑↓ to scroll │ Esc cancel │ Ctrl+D quit");
  lines.push(truncate(footerLine, width));

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main TUI App
// ---------------------------------------------------------------------------

export async function runTuiApp(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Alpha TUI requires an interactive terminal.");
    console.log("Use -p 'prompt' for non-interactive mode.");
    process.exit(1);
  }

  // Setup terminal
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(HIDE_CURSOR);

  const state = new TuiState();
  const adapter = new EventAdapter(state);

  // Load session
  const { provider, model, providerName } = createProvider();
  const config: CodingSessionConfig = {
    provider,
    model,
    cwd: process.cwd(),
    storage: new InMemorySessionStorage(),
    providerName,
  };

  const session = await CodingSession.load(config);
  state.provider = providerName;
  state.model = session.model;

  let pendingPrompt = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runningPrompt: AsyncIterable<any> | null = null;

  // Render function
  function render(): void {
    const output = renderTui(state);
    clearScreen();
    process.stdout.write(output);
  }

  // Input handler
  async function handleInput(data: Buffer): Promise<void> {
    const str = data.toString("utf-8");

    // Ctrl+C or Ctrl+D: exit
    if (str === "\x03" || str === "\x04") {
      cleanup();
      process.exit(0);
    }

    // Escape: cancel running or clear input
    if (str === "\x1b") {
      if (state.running) {
        session.cancel();
        state.addItem("status", "Cancelled");
        state.running = false;
        runningPrompt = null;
        render();
      }
      return;
    }

    // Arrow keys for scrolling
    if (str === "\x1b[A" || str === "\x1b[5~") { // Up or PgUp
      state.scrollUp();
      render();
      return;
    }
    if (str === "\x1b[B" || str === "\x1b[6~") { // Down or PgDn
      state.scrollDown();
      render();
      return;
    }

    // If running, ignore most input
    if (state.running) {
      return;
    }

    // Enter: submit
    if (str === "\r" || str === "\n") {
      if (pendingPrompt.trim()) {
        await submitPrompt(pendingPrompt);
        pendingPrompt = "";
        state.input = "";
      }
      return;
    }

    // Backspace
    if (str === "\x7f" || str === "\x08") {
      pendingPrompt = pendingPrompt.slice(0, -1);
      state.input = pendingPrompt;
      render();
      return;
    }

    // Regular character
    if (str.length === 1 && str.charCodeAt(0) >= 32) {
      pendingPrompt += str;
      state.input = pendingPrompt;
      render();
    }
  }

  // Submit prompt
  async function submitPrompt(text: string): Promise<void> {
    state.addItem("user", text);
    state.running = true;
    render();

    try {
      runningPrompt = session.prompt(text);
      for await (const event of runningPrompt) {
        adapter.apply(event);
        state.tokens = session.contextTokenEstimate;
        render();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.addItem("error", msg);
    } finally {
      state.running = false;
      runningPrompt = null;
    }
    render();
  }

  // Cleanup
  function cleanup(): void {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR);
    clearScreen();
  }

  // Setup input handler
  process.stdin.on("data", handleInput);
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  // Initial render
  render();

  // Keep process alive
  return new Promise(() => {});
}

if (import.meta.main) {
  runTuiApp();
}
