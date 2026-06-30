import { describe, test, expect, beforeEach } from "bun:test";
import {
  CommandRegistry,
  createDefaultCommandRegistry,
  type CommandSession,
  type CommandResult,
} from "../src/commands.ts";
import type { ThinkingLevel } from "../src/thinking.ts";

// ---------------------------------------------------------------------------
// Mock Command Session
// ---------------------------------------------------------------------------

function createMockSession(overrides: Partial<CommandSession> = {}): CommandSession {
  return {
    cwd: "/home/user/project",
    model: "gpt-4",
    providerName: "openai",
    availableModels: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
    availableProviders: ["openai", "anthropic", "openrouter"],
    tools: [],
    skills: [],
    promptTemplates: [],
    contextFiles: [],
    contextTokenEstimate: 1500,
    autoCompactTokenThreshold: null,
    contextWindowTokens: 128000,
    thinkingLevel: "medium" as ThinkingLevel,
    availableThinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"] as ThinkingLevel[],
    sessionId: "test-session-123",
    sessionTitle: "Test Session",
    setModel: () => {},
    reload: () => {},
    reloadProviderSettings: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Command Registry Tests
// ---------------------------------------------------------------------------

describe("CommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  test("registers and retrieves commands", () => {
    registry.register({
      name: "test",
      usage: "/test",
      description: "Test command",
      handler: () => ({ handled: true, message: "test" }),
    });

    const cmd = registry.get("test");
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("test");
    expect(cmd?.description).toBe("Test command");
  });

  test("registers aliases", () => {
    registry.register({
      name: "test",
      usage: "/test",
      description: "Test command",
      handler: () => ({ handled: true }),
      aliases: ["t", "tst"],
    });

    expect(registry.get("t")?.name).toBe("test");
    expect(registry.get("tst")?.name).toBe("test");
  });

  test("rejects duplicate commands", () => {
    registry.register({
      name: "test",
      usage: "/test",
      description: "First",
      handler: () => ({ handled: true }),
    });

    expect(() =>
      registry.register({
        name: "test",
        usage: "/test",
        description: "Second",
        handler: () => ({ handled: true }),
      })
    ).toThrow("Duplicate slash command");
  });

  test("listCommands returns sorted commands", () => {
    registry.register({
      name: "beta",
      usage: "/beta",
      description: "Beta",
      handler: () => ({ handled: true }),
    });
    registry.register({
      name: "alpha",
      usage: "/alpha",
      description: "Alpha",
      handler: () => ({ handled: true }),
    });
    registry.register({
      name: "gamma",
      usage: "/gamma",
      description: "Gamma",
      handler: () => ({ handled: true }),
    });

    const commands = registry.listCommands();
    expect(commands.map((c) => c.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("execute returns unhandled for non-commands", () => {
    const result = registry.execute(createMockSession(), "hello world");
    expect(result.handled).toBe(false);
  });

  test("execute returns unhandled for skill invocations", () => {
    const result = registry.execute(createMockSession(), "/skill:test do something");
    expect(result.handled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Default Command Registry Tests
// ---------------------------------------------------------------------------

describe("createDefaultCommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = createDefaultCommandRegistry();
  });

  test("has all expected commands", () => {
    const names = registry.listCommands().map((c) => c.name);
    expect(names).toContain("quit");
    expect(names).toContain("help");
    expect(names).toContain("new");
    expect(names).toContain("compact");
    expect(names).toContain("export");
    expect(names).toContain("session");
    expect(names).toContain("reload");
    expect(names).toContain("resume");
    expect(names).toContain("tree");
    expect(names).toContain("model");
    expect(names).toContain("thinking");
    expect(names).toContain("login");
    expect(names).toContain("logout");
    expect(names).toContain("theme");
  });

  test("/quit returns exitRequested", () => {
    const result = registry.execute(createMockSession(), "/quit");
    expect(result.handled).toBe(true);
    expect(result.exitRequested).toBe(true);
  });

  test("/quit alias /q works", () => {
    const result = registry.execute(createMockSession(), "/q");
    expect(result.handled).toBe(true);
    expect(result.exitRequested).toBe(true);
  });

  test("/help returns message", () => {
    const result = registry.execute(createMockSession(), "/help");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Available commands");
  });

  test("/new returns newSessionRequested", () => {
    const result = registry.execute(createMockSession(), "/new");
    expect(result.handled).toBe(true);
    expect(result.newSessionRequested).toBe(true);
  });

  test("/compact returns compactSummary", () => {
    const result = registry.execute(createMockSession(), "/compact focus on tests");
    expect(result.handled).toBe(true);
    expect(result.compactSummary).toBe("focus on tests");
  });

  test("/compact without args works", () => {
    const result = registry.execute(createMockSession(), "/compact");
    expect(result.handled).toBe(true);
  });

  test("/session shows session info", () => {
    const result = registry.execute(createMockSession(), "/session");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Model: gpt-4");
    expect(result.message).toContain("Provider: openai");
    expect(result.message).toContain("Session: test-session-123");
  });

  test("/model shows picker when no args", () => {
    const result = registry.execute(createMockSession(), "/model");
    expect(result.handled).toBe(true);
    expect(result.modelPickerRequested).toBe(true);
  });

  test("/model sets model with args", () => {
    const session = createMockSession();
    const result = registry.execute(session, "/model gpt-4-turbo");
    expect(result.handled).toBe(true);
    expect(result.message).toBe("Current model: gpt-4-turbo");
  });

  test("/model rejects unknown model", () => {
    const result = registry.execute(createMockSession(), "/model unknown-model");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Unknown model");
  });

  test("/thinking shows current level", () => {
    const result = registry.execute(createMockSession(), "/thinking");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Thinking mode: medium");
  });

  test("/thinking changes level", () => {
    const result = registry.execute(createMockSession(), "/thinking high");
    expect(result.handled).toBe(true);
    expect(result.thinkingLevel).toBe("high");
  });

  test("/thinking rejects unavailable level", () => {
    const result = registry.execute(createMockSession(), "/thinking ultra");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Unknown thinking level");
  });

  test("/export requests export", () => {
    const result = registry.execute(createMockSession(), "/export session.html");
    expect(result.handled).toBe(true);
    expect(result.exportRequested).toBe(true);
    expect(result.exportDestination).toBe("session.html");
  });

  test("/export with format", () => {
    const result = registry.execute(createMockSession(), "/export --format jsonl output.jsonl");
    expect(result.handled).toBe(true);
    expect(result.exportFormat).toBe("jsonl");
    expect(result.exportDestination).toBe("output.jsonl");
  });

  test("/resume shows picker when no args", () => {
    const result = registry.execute(createMockSession(), "/resume");
    expect(result.handled).toBe(true);
    expect(result.resumePickerRequested).toBe(true);
  });

  test("/resume with session id", () => {
    const result = registry.execute(createMockSession(), "/resume abc123");
    expect(result.handled).toBe(true);
    expect(result.resumeSessionId).toBe("abc123");
  });

  test("/tree shows tree picker", () => {
    const result = registry.execute(createMockSession(), "/tree");
    expect(result.handled).toBe(true);
    expect(result.treePickerRequested).toBe(true);
  });

  test("/login shows picker when no args", () => {
    const result = registry.execute(createMockSession(), "/login");
    expect(result.handled).toBe(true);
    expect(result.loginPickerRequested).toBe(true);
  });

  test("/login with provider", () => {
    const result = registry.execute(createMockSession(), "/login openai");
    expect(result.handled).toBe(true);
    expect(result.loginProvider).toBe("openai");
  });

  test("/logout with provider", () => {
    const result = registry.execute(createMockSession(), "/logout anthropic");
    expect(result.handled).toBe(true);
    expect(result.logoutProvider).toBe("anthropic");
  });

  test("/theme shows picker when no args", () => {
    const result = registry.execute(createMockSession(), "/theme");
    expect(result.handled).toBe(true);
    expect(result.themePickerRequested).toBe(true);
  });

  test("/theme sets theme", () => {
    const result = registry.execute(createMockSession(), "/theme tau-dark");
    expect(result.handled).toBe(true);
    expect(result.theme).toBe("tau-dark");
  });

  test("/theme rejects unknown theme", () => {
    const result = registry.execute(createMockSession(), "/theme unknown");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Unknown theme");
  });

  test("/reload performs reload", () => {
    const result = registry.execute(createMockSession(), "/reload");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Reloaded");
  });

  test("/hotkeys shows shortcuts", () => {
    const result = registry.execute(createMockSession(), "/hotkeys");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("keyboard shortcuts");
  });

  test("/name shows current name", () => {
    const result = registry.execute(createMockSession(), "/name");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Current session name: Test Session");
  });

  test("/name sets new name", () => {
    const result = registry.execute(createMockSession(), "/name My New Session");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("My New Session");
  });

  test("unknown command returns error message", () => {
    const result = registry.execute(createMockSession(), "/unknown");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Unknown command");
  });

  test("case insensitive commands", () => {
    const result = registry.execute(createMockSession(), "/QUIT");
    expect(result.handled).toBe(true);
    expect(result.exitRequested).toBe(true);
  });

  test("scoped models alias works", () => {
    const result = registry.execute(createMockSession(), "/scoped models");
    expect(result.handled).toBe(true);
    expect(result.scopedModelsPickerRequested).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Command Parsing Tests
// ---------------------------------------------------------------------------

describe("command parsing", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = createDefaultCommandRegistry();
  });

  test("handles commands with extra whitespace", () => {
    const result = registry.execute(createMockSession(), "  /quit  ");
    expect(result.handled).toBe(true);
    expect(result.exitRequested).toBe(true);
  });

  test("handles commands with multiple arguments", () => {
    const result = registry.execute(createMockSession(), "/name New Session Name");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("New Session Name");
  });

  test("handles export with format before destination", () => {
    const result = registry.execute(createMockSession(), "/export --format html my-session.html");
    expect(result.handled).toBe(true);
    expect(result.exportFormat).toBe("html");
    expect(result.exportDestination).toBe("my-session.html");
  });

  test("handles export with format after destination", () => {
    const result = registry.execute(createMockSession(), "/export my-session.html --format html");
    expect(result.handled).toBe(true);
    expect(result.exportFormat).toBe("html");
  });

  test("rejects invalid export format", () => {
    const result = registry.execute(createMockSession(), "/export --format pdf output.pdf");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("Invalid export format");
  });
});
