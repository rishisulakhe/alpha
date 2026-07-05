/**
 * Alpha TUI - Minimal ANSI-based terminal UI with proper streaming.
 *
 * Key features:
 * - Streams responses line-by-line (like Tau)
 * - Proper scrolling with page-up/page-down
 * - Differential rendering for smooth updates
 * - Thinking indicator
 * - Tool call display
 */

import * as process from "node:process";
import { InMemorySessionStorage } from "@alpha/agent";
import { CodingSession, type CodingSessionConfig } from "../session.ts";
import { createProvider } from "../provider.ts";
import type { AgentEvent, ToolCall, AgentToolResult } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESC = "\x1b[";
const ALT_SCREEN_ENTER = `${ESC}?1049h`;
const ALT_SCREEN_EXIT = `${ESC}?1049l`;
const CLEAR_SCREEN = `${ESC}2J${ESC}H`;
const SHOW_CURSOR = `${ESC}?25h`;
const HIDE_CURSOR = `${ESC}?25l`;
const RESET = "\x1b[0m";

const RENDER_INTERVAL_MS = 50; // ~20 FPS for smooth streaming

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatItemRole = "user" | "assistant" | "tool" | "thinking" | "error" | "status";

interface ChatItem {
  id: number;
  role: ChatItemRole;
  text: string;
  toolName?: string;
  toolOk?: boolean;
  /** For streaming - indicates this item is still being updated */
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// TuiState - Mutable display state (like Tau's TuiState)
// ---------------------------------------------------------------------------

class TuiState {
  items: ChatItem[] = [];
  assistantBuffer = "";
  running = false;
  error: string | null = null;
  input = "";
  provider = "demo";
  model = "loading...";
  tokens = 0;
  scrollOffset = 0;
  userHasScrolled = false;
  showThinking = true;

  private _nextId = 1;
  private _termHeight = 24;
  private _termWidth = 80;

  updateTermSize(width: number, height: number): void {
    this._termWidth = width;
    this._termHeight = height;
  }

  get termHeight(): number { return this._termHeight; }
  get termWidth(): number { return this._termWidth; }

  addItem(role: ChatItemRole, text: string, opts: { toolName?: string; toolOk?: boolean; streaming?: boolean } = {}): void {
    // For assistant streaming, update the last item if it's still streaming
    if (role === "assistant" && this.items.length > 0) {
      const lastItem = this.items[this.items.length - 1];
      if (lastItem?.role === "assistant" && lastItem.streaming) {
        lastItem.text = text;
        this._autoScroll();
        return;
      }
    }

    // For thinking, just update placeholder
    if (role === "thinking") {
      const existingThinking = this.items.find(i => i.role === "thinking" && i.streaming);
      if (existingThinking) {
        existingThinking.text = "💭 Thinking...";
        return;
      }
    }

    this.items.push({
      id: this._nextId++,
      role,
      text,
      ...opts,
    });
    this._autoScroll();
  }

  /** Append a text delta to the current assistant message (streaming) */
  appendAssistantDelta(delta: string): void {
    const lastItem = this.items[this.items.length - 1];
    if (lastItem?.role === "assistant" && lastItem.streaming) {
      lastItem.text += delta;
    } else {
      // Start a new streaming assistant message
      this.items.push({
        id: this._nextId++,
        role: "assistant",
        text: delta,
        streaming: true,
      });
    }
    this._autoScroll();
  }

  /** Append thinking delta */
  appendThinkingDelta(_delta: string): void {
    // Show thinking indicator
    const existingThinking = this.items.find(i => i.role === "thinking" && i.streaming);
    if (!existingThinking) {
      this.items.push({
        id: this._nextId++,
        role: "thinking",
        text: "💭 Thinking...",
        streaming: true,
      });
      this._autoScroll();
    }
  }

  /** Finalize the current assistant message */
  finishAssistantMessage(): void {
    const lastItem = this.items[this.items.length - 1];
    if (lastItem?.role === "assistant") {
      lastItem.streaming = false;
    }
    // Remove thinking indicator if present
    const thinkingIdx = this.items.findIndex(i => i.role === "thinking" && i.streaming);
    if (thinkingIdx >= 0) {
      this.items.splice(thinkingIdx, 1);
    }
  }

  /** Add a tool call */
  addToolCall(call: ToolCall): void {
    // Remove thinking if present
    const thinkingIdx = this.items.findIndex(i => i.role === "thinking");
    if (thinkingIdx >= 0) {
      this.items.splice(thinkingIdx, 1);
    }

    this.items.push({
      id: this._nextId++,
      role: "tool",
      text: this._formatToolCall(call),
      toolName: call.name,
      streaming: true,
    });
    this._autoScroll();
  }

  /** Record a tool result */
  recordToolResult(result: AgentToolResult): void {
    // Find the matching tool call
    const lastTool = this.items.find(i => i.role === "tool" && i.streaming);
    if (lastTool) {
      lastTool.streaming = false;
      lastTool.toolOk = result.ok;
      lastTool.text = this._formatToolResult(result);
    } else {
      this.items.push({
        id: this._nextId++,
        role: "tool",
        text: this._formatToolResult(result),
        toolName: result.name,
        toolOk: result.ok,
      });
    }
    this._autoScroll();
  }

  clear(): void {
    this.items = [];
    this.assistantBuffer = "";
    this.scrollOffset = 0;
    this.userHasScrolled = false;
    this.error = null;
  }

  scrollUp(lines: number = 1): void {
    if (this.scrollOffset > 0) {
      this.scrollOffset = Math.max(0, this.scrollOffset - lines);
      this.userHasScrolled = true;
    }
  }

  scrollDown(lines: number = 1): void {
    const maxOffset = Math.max(0, this.items.length - this._getVisibleLines());
    if (this.scrollOffset < maxOffset) {
      this.scrollOffset = Math.min(maxOffset, this.scrollOffset + lines);
      if (this.scrollOffset >= maxOffset) {
        this.userHasScrolled = false;
      }
    }
  }

  scrollPageUp(): void {
    this.scrollUp(Math.floor(this._termHeight / 2));
  }

  scrollPageDown(): void {
    this.scrollDown(Math.floor(this._termHeight / 2));
  }

  scrollToBottom(): void {
    this.scrollOffset = 0;
    this.userHasScrolled = false;
  }

  getVisibleItems(): ChatItem[] {
    const visibleLines = this._getVisibleLines();
    // Show from the end (newest) backward
    const start = Math.max(0, this.items.length - visibleLines - this.scrollOffset);
    const end = this.items.length - this.scrollOffset;
    return this.items.slice(start, end);
  }

  private _getVisibleLines(): number {
    // Reserve 4 lines for header, input, and status
    return Math.max(1, this._termHeight - 5);
  }

  private _autoScroll(): void {
    if (!this.userHasScrolled) {
      this.scrollOffset = 0;
    }
  }

  private _formatToolCall(call: ToolCall): string {
    const args = call.arguments as Record<string, unknown>;
    const firstKey = Object.keys(args)[0];
    if (firstKey && typeof args[firstKey] === "string") {
      const val = args[firstKey] as string;
      const preview = val.slice(0, 50);
      return `→ ${call.name}: ${firstKey}=${preview}${val.length > 50 ? "…" : ""}`;
    }
    return `→ ${call.name}`;
  }

  private _formatToolResult(result: AgentToolResult): string {
    const status = result.ok ? "✓" : "✗";
    const content = result.content.slice(0, 100).replace(/\n/g, " ");
    return `${status} ${result.name}: ${content}${result.content.length > 100 ? "…" : ""}`;
  }
}

// ---------------------------------------------------------------------------
// TuiEventAdapter - Apply agent events to TuiState (like Tau's adapter)
// ---------------------------------------------------------------------------

class TuiEventAdapter {
  constructor(private state: TuiState) {}

  apply(event: AgentEvent): void {
    switch (event.type) {
      case "agent_start":
        this.state.running = true;
        this.state.error = null;
        break;

      case "agent_end":
        this.state.finishAssistantMessage();
        this.state.running = false;
        break;

      case "message_start":
        // Handled per-type below
        break;

      case "message_delta":
        this.state.appendAssistantDelta(event.text);
        break;

      case "thinking_delta":
        this.state.appendThinkingDelta(event.text);
        break;

      case "message_end": {
        const msg = event.message;
        if (msg.role === "user") {
          this.state.addItem("user", msg.content);
        } else if (msg.role === "assistant") {
          // Finalize the streaming message
          this.state.finishAssistantMessage();
          // If there's content, replace the streaming text with final content
          if (msg.content) {
            this.state.addItem("assistant", msg.content);
          }
        } else if (msg.role === "tool") {
          // Tool result - already handled by tool_execution_end
        }
        break;
      }

      case "tool_execution_start":
        if (event.call) {
          this.state.addToolCall(event.call);
        }
        break;

      case "tool_execution_end":
        this.state.recordToolResult(event.result);
        break;

      case "retry":
        this.state.addItem("status", `Retrying: ${event.message}`);
        break;

      case "error":
        this.state.finishAssistantMessage();
        if (event.recoverable && event.message === "Agent run cancelled") {
          this.state.addItem("status", "Cancelled.");
        } else {
          this.state.error = event.message;
          this.state.addItem("error", `Error: ${event.message}`);
          if (!event.recoverable) {
            this.state.running = false;
          }
        }
        break;

      case "turn_start":
      case "turn_end":
      case "queue_update":
        // Not displayed in simple TUI
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function fg(color: number | string, text: string): string {
  if (typeof color === "number") {
    return `${ESC}38;5;${color}m${text}${RESET}`;
  }
  return `${ESC}38;5;${color}m${text}${RESET}`;
}

function dim(text: string): string { return `${ESC}2m${text}${RESET}`; }
function bold(text: string): string { return `${ESC}1m${text}${RESET}`; }
function green(text: string): string { return fg(2, text); }
function cyan(text: string): string { return fg(6, text); }
function yellow(text: string): string { return fg(3, text); }
function red(text: string): string { return fg(1, text); }
function magenta(text: string): string { return fg(5, text); }

function truncate(str: string, width: number): string {
  if (str.length <= width) return str;
  return str.slice(0, width - 1) + "…";
}

function repeat(char: string, count: number): string {
  return char.repeat(Math.max(0, count));
}

function renderTui(state: TuiState): string {
  const { termWidth, termHeight } = state;
  const lines: string[] = [];

  // Header
  const statusColor = state.running ? yellow : cyan;
  const statusIcon = state.running ? "⏳" : "α";
  lines.push(`${statusColor(statusIcon)} ${dim(state.provider)}:${state.model} ${dim("│")} tokens: ~${state.tokens}`);
  lines.push(dim(repeat("─", termWidth - 1)));

  // Chat area
  const chatHeight = termHeight - 5;
  const items = state.getVisibleItems();

  // Scroll indicator
  if (state.scrollOffset > 0) {
    lines.push(dim(`↑ more above (${state.scrollOffset} lines)`));
  }

  for (const item of items) {
    // Skip thinking if not shown
    if (item.role === "thinking" && !state.showThinking) continue;

    const itemLines = item.text.split("\n");
    for (const line of itemLines) {
      const truncated = truncate(line, termWidth - 3);
      switch (item.role) {
        case "user":
          lines.push(`${cyan("❯")} ${truncated}`);
          break;
        case "assistant":
          lines.push(`${green("❮")} ${truncated}`);
          break;
        case "thinking":
          lines.push(`${magenta("💭")} ${dim(truncated)}`);
          break;
        case "tool":
          const icon = item.toolOk === false ? red("✗") : item.toolOk === true ? green("✓") : yellow("⚙");
          lines.push(`${icon} ${truncated}`);
          break;
        case "error":
          lines.push(`${red("✗")} ${truncated}`);
          break;
        case "status":
          lines.push(dim(`• ${truncated}`));
          break;
      }
    }
  }

  // Fill remaining space
  while (lines.length < chatHeight + 2) {
    lines.push("");
  }

  // Footer
  lines.push(dim(repeat("─", termWidth - 1)));

  // Input line
  const promptSymbol = state.running ? yellow("⏳") : cyan("❯");
  const cursor = state.running ? "" : "█";
  lines.push(`${promptSymbol} ${state.input}${cursor}`);

  // Status line
  const footerLine = state.running
    ? yellow("Working... (Esc cancel, Ctrl+D quit)")
    : dim("Enter send │ ↑↓ scroll │ PgUp/PgDn │ End bottom │ Esc cancel │ Ctrl+D quit");
  lines.push(truncate(footerLine, termWidth));

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
  process.stdout.write(ALT_SCREEN_ENTER);
  process.stdout.write(HIDE_CURSOR);

  const state = new TuiState();
  const adapter = new TuiEventAdapter(state);

  // Get terminal size
  function updateTermSize(): void {
    state.updateTermSize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
  }
  updateTermSize();

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
  let lastRenderTime = 0;
  let rendering = false;
  let renderScheduled = false;

  function scheduleRender(): void {
    if (rendering) return;

    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTime;

    if (timeSinceLastRender >= RENDER_INTERVAL_MS) {
      render();
    } else if (!renderScheduled) {
      renderScheduled = true;
      setTimeout(() => {
        if (!rendering) {
          render();
        }
      }, RENDER_INTERVAL_MS - timeSinceLastRender);
    }
  }

  function render(): void {
    if (rendering) return;
    rendering = true;
    try {
      updateTermSize();
      process.stdout.write(`${ESC}H${ESC}J${renderTui(state)}`);
      lastRenderTime = Date.now();
      renderScheduled = false;
    } finally {
      rendering = false;
    }
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
        render();
      }
      return;
    }

    // Scroll keys
    if (str === "\x1b[A" || str === "\x1b[5~") { // Up or PgUp
      state.scrollUp(str === "\x1b[5~" ? 10 : 1);
      render();
      return;
    }
    if (str === "\x1b[B" || str === "\x1b[6~") { // Down or PgDn
      state.scrollDown(str === "\x1b[6~" ? 10 : 1);
      render();
      return;
    }
    if (str === "\x1b[F" || str === "\x1b[4~") { // End key
      state.scrollToBottom();
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
    state.scrollToBottom();
    render();

    try {
      for await (const event of session.prompt(text)) {
        adapter.apply(event);
        state.tokens = session.contextTokenEstimate;
        scheduleRender();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.addItem("error", msg);
    } finally {
      state.running = false;
      state.finishAssistantMessage();
    }
    render();
  }

  // Cleanup
  function cleanup(): void {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write(ALT_SCREEN_EXIT);
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
