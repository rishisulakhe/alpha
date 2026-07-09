import { describe, test, expect } from "bun:test";
import { getCompletions, applyCompletion, SLASH_COMMANDS } from "../src/tui/autocomplete.tsx";
import type { CompletionState } from "../src/tui/autocomplete.tsx";
import { TuiState } from "../src/tui/state.ts";
import { TuiEventAdapter } from "../src/tui/adapter.ts";
import type { AgentEvent } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Autocomplete Tests
// ---------------------------------------------------------------------------

describe("getCompletions", () => {
  test("returns slash command completions for / prefix", () => {
    const state = getCompletions("/qu", 3);
    expect(state).not.toBeNull();
    expect(state!.items.length).toBeGreaterThan(0);
    expect(state!.items[0]!.label).toContain("/quit");
    expect(state!.triggerRange).toEqual({ start: 0, end: 3 });
  });

  test("returns all commands for just /", () => {
    const state = getCompletions("/", 1);
    expect(state).not.toBeNull();
    expect(state!.items.length).toBe(SLASH_COMMANDS.length);
  });

  test("returns null for non-command input", () => {
    const state = getCompletions("hello world", 11);
    expect(state).toBeNull();
  });

  test("returns null after command is complete", () => {
    const state = getCompletions("/quit ", 6);
    expect(state).toBeNull();
  });

  test("searches by partial command name", () => {
    const state = getCompletions("/mo", 3);
    expect(state).not.toBeNull();
    expect(state!.items.some((i) => i.id === "model")).toBe(true);
  });

  test("returns model completions after /model ", () => {
    const state = getCompletions("/model gp", 9, {
      models: ["gpt-4", "gpt-4-turbo", "claude-3"],
    });
    expect(state).not.toBeNull();
    expect(state!.items.length).toBeGreaterThan(0);
    expect(state!.items[0]!.label).toContain("gpt");
  });

  test("returns skill completions after /skill:", () => {
    const state = getCompletions("/skill:te", 9, {
      skills: ["test-skill", "terminal", "typescript"],
    });
    expect(state).not.toBeNull();
    expect(state!.items.some((i) => i.label.includes("test") || i.label.includes("terminal"))).toBe(
      true,
    );
  });

  test("handles empty models list", () => {
    const state = getCompletions("/model gp", 9, { models: [] });
    expect(state).toBeNull();
  });

  test("handles empty skills list", () => {
    const state = getCompletions("/skill:te", 9, { skills: [] });
    expect(state).toBeNull();
  });
});

describe("applyCompletion", () => {
  test("applies completion for slash command", () => {
    const result = applyCompletion("/qu", SLASH_COMMANDS[0]!, { start: 0, end: 3 });
    expect(result.input).toBe("/quit");
    expect(result.cursorPosition).toBe(5);
  });

  test("preserves text after trigger", () => {
    const result = applyCompletion("/qu some args", SLASH_COMMANDS[0]!, { start: 0, end: 3 });
    expect(result.input).toBe("/quit some args");
    expect(result.cursorPosition).toBe(5);
  });

  test("applies model completion", () => {
    const modelCompletion = {
      id: "gpt-4",
      label: "gpt-4",
      insertText: "gpt-4",
    };
    const result = applyCompletion("/model gp", modelCompletion, { start: 7, end: 9 });
    expect(result.input).toBe("/model gpt-4");
  });
});

// ---------------------------------------------------------------------------
// Picker Tests
// ---------------------------------------------------------------------------

describe("Picker Items", () => {
  test("slash commands have required fields", () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.id).toBeDefined();
      expect(cmd.label).toBeDefined();
      expect(cmd.insertText).toBeDefined();
      expect(cmd.label.startsWith("/")).toBe(true);
    }
  });

  test("slash commands have unique IDs", () => {
    const ids = new Set(SLASH_COMMANDS.map((c) => c.id));
    expect(ids.size).toBe(SLASH_COMMANDS.length);
  });

  test("insertText for commands that take args have trailing space", () => {
    const argsCommands = SLASH_COMMANDS.filter((c) =>
      ["compact", "export", "name", "thinking", "login", "logout", "resume"].includes(c.id),
    );
    for (const cmd of argsCommands) {
      expect(cmd.insertText.endsWith(" ")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// TUI Theme Tests
// ---------------------------------------------------------------------------

import { BUILTIN_THEMES, type ThemeId } from "../src/tui/pickers.tsx";

describe("Themes", () => {
  test("builtin themes have required fields", () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.id).toBeDefined();
      expect(theme.label).toBeDefined();
      expect(theme.description).toBeDefined();
    }
  });

  test("builtin themes have unique IDs", () => {
    const ids = new Set(BUILTIN_THEMES.map((t) => t.id));
    expect(ids.size).toBe(BUILTIN_THEMES.length);
  });

  test("builtin themes include standard options", () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).toContain("tau-dark");
    expect(ids).toContain("tau-light");
    expect(ids).toContain("high-contrast");
  });
});

// ---------------------------------------------------------------------------
// Thinking Level Tests
// ---------------------------------------------------------------------------

import { THINKING_LEVELS } from "../src/tui/pickers.tsx";

describe("Thinking Levels", () => {
  test("thinking levels have required fields", () => {
    for (const level of THINKING_LEVELS) {
      expect(level.id).toBeDefined();
      expect(level.label).toBeDefined();
      expect(level.description).toBeDefined();
    }
  });

  test("thinking levels have unique IDs", () => {
    const ids = new Set(THINKING_LEVELS.map((l) => l.id));
    expect(ids.size).toBe(THINKING_LEVELS.length);
  });

  test("thinking levels include all standard levels", () => {
    const ids = THINKING_LEVELS.map((l) => l.id);
    expect(ids).toContain("off");
    expect(ids).toContain("minimal");
    expect(ids).toContain("low");
    expect(ids).toContain("medium");
    expect(ids).toContain("high");
    expect(ids).toContain("xhigh");
  });
});

// ---------------------------------------------------------------------------
// TuiState Tests
// ---------------------------------------------------------------------------

describe("TuiState", () => {
  test("starts with empty items and not running", () => {
    const state = new TuiState();
    expect(state.items).toEqual([]);
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
  });

  test("addUserMessage adds a user chat item", () => {
    const state = new TuiState();
    state.addUserMessage("hello");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("user");
    expect(state.items[0]!.text).toBe("hello");
  });

  test("addAssistantMessage adds an assistant chat item", () => {
    const state = new TuiState();
    state.addAssistantMessage("response");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("assistant");
    expect(state.items[0]!.text).toBe("response");
  });

  test("addToolCall adds a tool item with formatted name", () => {
    const state = new TuiState();
    state.addToolCall({ id: "t1", name: "bash", arguments: { command: "ls -la" } });
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("tool");
    expect(state.items[0]!.toolName).toBe("bash");
  });

  test("recordToolResult updates the matching tool call item", () => {
    const state = new TuiState();
    state.addToolCall({ id: "t1", name: "read", arguments: { filePath: "foo.ts" } });
    state.recordToolResult({
      toolCallId: "t1",
      name: "read",
      ok: true,
      content: "file contents",
    });
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.text).toContain("read");
    expect(state.items[0]!.text).toContain("file contents");
  });

  test("recordToolResult adds new item if no matching tool call", () => {
    const state = new TuiState();
    state.recordToolResult({
      toolCallId: "missing",
      name: "read",
      ok: false,
      content: "error msg",
    });
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("tool");
    expect(state.items[0]!.toolName).toBe("read");
  });

  test("addThinkingDelta appends to existing thinking item", () => {
    const state = new TuiState();
    state.addThinkingDelta("thinking...");
    state.addThinkingDelta(" more");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("thinking");
    expect(state.items[0]!.text).toBe("thinking... more");
  });

  test("addError sets error field and adds error item", () => {
    const state = new TuiState();
    state.addError("something went wrong");
    expect(state.error).toBe("something went wrong");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("error");
    expect(state.items[0]!.text).toContain("something went wrong");
  });

  test("addStatus adds a status item", () => {
    const state = new TuiState();
    state.addStatus("info msg");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("status");
    expect(state.items[0]!.text).toBe("info msg");
  });

  test("clear resets state", () => {
    const state = new TuiState();
    state.addUserMessage("hello");
    state.running = true;
    state.error = "err";
    state.clear();
    expect(state.items).toEqual([]);
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
  });

  test("toggleThinking toggles showThinking", () => {
    const state = new TuiState();
    expect(state.showThinking).toBe(false);
    expect(state.toggleThinking()).toBe(true);
    expect(state.toggleThinking()).toBe(false);
  });

  test("toggleToolResults toggles showToolResults", () => {
    const state = new TuiState();
    expect(state.showToolResults).toBe(false);
    expect(state.toggleToolResults()).toBe(true);
    expect(state.toggleToolResults()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TuiEventAdapter Tests
// ---------------------------------------------------------------------------

function makeAgentEvent(partial: Partial<AgentEvent> & { type: string }): AgentEvent {
  return partial as unknown as AgentEvent;
}

describe("TuiEventAdapter", () => {
  test("agent_start sets running and clears error", () => {
    const state = new TuiState();
    state.error = "old error";
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({ type: "agent_start" }));
    expect(state.running).toBe(true);
    expect(state.error).toBeNull();
  });

  test("agent_end flushes buffer and stops running", () => {
    const state = new TuiState();
    state.running = true;
    state.assistantBuffer = "buffered text";
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({ type: "agent_end" }));
    expect(state.running).toBe(false);
    expect(state.assistantBuffer).toBe("");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("assistant");
    expect(state.items[0]!.text).toBe("buffered text");
  });

  test("message_start (assistant) clears buffer", () => {
    const state = new TuiState();
    state.assistantBuffer = "old";
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({ type: "message_start", role: "assistant" }));
    expect(state.assistantBuffer).toBe("");
  });

  test("message_delta appends to assistant buffer", () => {
    const state = new TuiState();
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({ type: "message_delta", text: "Hello" }));
    adapter.apply(makeAgentEvent({ type: "message_delta", text: " World" }));
    expect(state.assistantBuffer).toBe("Hello World");
  });

  test("thinking_delta adds thinking item", () => {
    const state = new TuiState();
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({ type: "thinking_delta", text: "hmm..." }));
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("thinking");
    expect(state.items[0]!.text).toContain("hmm...");
  });

  test("message_end (user) adds user message", () => {
    const state = new TuiState();
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({
      type: "message_end",
      message: { role: "user", content: "hi" },
    }));
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("user");
    expect(state.items[0]!.text).toBe("hi");
  });

  test("tool_execution_start flushes buffer and adds tool call", () => {
    const state = new TuiState();
    state.assistantBuffer = "text before tool";
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({
      type: "tool_execution_start",
      call: { id: "tc1", name: "read", arguments: { filePath: "src/app.ts" } },
    }));
    expect(state.assistantBuffer).toBe("");
    expect(state.items.length).toBe(2);
    expect(state.items[0]!.role).toBe("assistant");
    expect(state.items[0]!.text).toBe("text before tool");
    expect(state.items[1]!.role).toBe("tool");
    expect(state.items[1]!.toolName).toBe("read");
  });

  test("tool_execution_end records result", () => {
    const state = new TuiState();
    state.addToolCall({ id: "tc1", name: "read", arguments: {} });
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({
      type: "tool_execution_end",
      result: { toolCallId: "tc1", name: "read", ok: true, content: "result" },
    }));
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.text).toContain("result");
  });

  test("retry adds status message", () => {
    const state = new TuiState();
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({
      type: "retry",
      message: "Retrying in 2s",
      attempt: 1,
      maxAttempts: 3,
      delaySeconds: 2,
    }));
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("status");
    expect(state.items[0]!.text).toContain("Retrying");
  });

  test("recoverable error on cancel adds status", () => {
    const state = new TuiState();
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({
      type: "error",
      message: "Agent run cancelled",
      recoverable: true,
    }));
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("status");
    expect(state.items[0]!.text).toBe("Agent run cancelled.");
  });

  test("non-recoverable error stops running and adds error", () => {
    const state = new TuiState();
    state.running = true;
    const adapter = new TuiEventAdapter(state);
    adapter.apply(makeAgentEvent({
      type: "error",
      message: "fatal error",
      recoverable: false,
    }));
    expect(state.running).toBe(false);
    expect(state.error).toBe("fatal error");
    expect(state.items.length).toBe(1);
    expect(state.items[0]!.role).toBe("error");
  });
});
