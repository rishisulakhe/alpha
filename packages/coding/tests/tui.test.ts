import { describe, test, expect } from "bun:test";
import { getCompletions, applyCompletion, SLASH_COMMANDS } from "../src/tui/autocomplete.tsx";
import type { CompletionState } from "../src/tui/autocomplete.tsx";

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
