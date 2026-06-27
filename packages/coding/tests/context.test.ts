import { describe, expect, test } from "bun:test";
import { discoverProjectContext, type ProjectContextFile } from "../src/context/discovery.ts";
import { estimateTextTokens, estimateMessageTokens, estimateToolTokens, estimateContextTokens, autoCompactionThreshold, DEFAULT_CONTEXT_WINDOW } from "../src/context/tokens.ts";
import type { AgentMessage, AgentTool } from "@alpha/agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// === Step 34: Context Discovery ===

describe("discoverProjectContext", () => {
  test("discovers AGENTS.md from project root", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-ctx-"));
    // Create project root marker
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    // Create AGENTS.md at root
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Project instructions.");
    try {
      const ctx = discoverProjectContext(tmpDir);
      expect(ctx.length).toBeGreaterThanOrEqual(1);
      expect(ctx.some((c) => c.content.includes("Project instructions"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("discovers from .alpha/AGENTS.md", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-ctx-local-"));
    const alphaDir = path.join(tmpDir, ".alpha");
    fs.mkdirSync(alphaDir);
    fs.writeFileSync(path.join(alphaDir, "AGENTS.md"), "Local config.");
    try {
      const ctx = discoverProjectContext(tmpDir);
      expect(ctx.some((c) => c.content.includes("Local config"))).toBe(true);
      expect(ctx[0]!.source).toBe("local");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("deduplicates by content hash", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-ctx-dedup-"));
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    const content = "Same content everywhere.";
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), content);
    const alphaDir = path.join(tmpDir, ".alpha");
    fs.mkdirSync(alphaDir);
    fs.writeFileSync(path.join(alphaDir, "AGENTS.md"), content);
    try {
      const ctx = discoverProjectContext(tmpDir);
      const matching = ctx.filter((c) => c.content === content);
      expect(matching.length).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("sorts by priority: local > project > home", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-ctx-priority-"));
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Project.");
    const alphaDir = path.join(tmpDir, ".alpha");
    fs.mkdirSync(alphaDir);
    fs.writeFileSync(path.join(alphaDir, "AGENTS.md"), "Local.");
    try {
      const ctx = discoverProjectContext(tmpDir);
      expect(ctx.length).toBeGreaterThanOrEqual(1);
      // Last entry should be highest priority (local)
      const last = ctx[ctx.length - 1]!;
      expect(last.source).toBe("local");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("empty project returns empty array", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-ctx-empty-"));
    try {
      const ctx = discoverProjectContext(tmpDir);
      // May have home context, but not project/local
      const projectCtx = ctx.filter((c) => c.source !== "home");
      expect(projectCtx.length).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// === Step 35: Token Estimation ===

describe("estimateTextTokens", () => {
  test("empty string returns 0", () => {
    expect(estimateTextTokens("")).toBe(0);
  });

  test("single char returns 1", () => {
    expect(estimateTextTokens("a")).toBe(1);
  });

  test("exact multiple returns chars/4", () => {
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcdefgh")).toBe(2);
  });

  test("partial multiple rounds up", () => {
    expect(estimateTextTokens("abcde")).toBe(2);
  });
});

describe("estimateMessageTokens", () => {
  test("user message includes role overhead", () => {
    const msg: AgentMessage = { role: "user", content: "hello" };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThanOrEqual(4);
  });

  test("assistant message with tool calls counts higher", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: "Let me read that.",
      tool_calls: [{ id: "c1", name: "read", arguments: { path: "file.txt" } }],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(10);
  });
});

describe("estimateToolTokens", () => {
  test("includes overhead, name, description, schema", () => {
    const tool: AgentTool = {
      name: "read",
      description: "Read a file.",
      inputSchema: { type: "object" },
      async execute() { return { toolCallId: "", name: "read", ok: true, content: "" }; },
    };
    const tokens = estimateToolTokens(tool);
    expect(tokens).toBeGreaterThan(16);
  });
});

describe("estimateContextTokens", () => {
  test("returns structured estimate", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "hello" }];
    const estimate = estimateContextTokens("You are helpful.", messages, []);
    expect(estimate.messageCount).toBe(1);
    expect(estimate.toolCount).toBe(0);
    expect(estimate.totalTokens).toBeGreaterThan(0);
    expect(estimate.totalTokens).toBe(estimate.systemTokens + estimate.messageTokens + estimate.toolTokens);
  });
});

describe("autoCompactionThreshold", () => {
  test("subtracts 16384 from context window", () => {
    expect(autoCompactionThreshold(100000)).toBe(100000 - 16384);
  });

  test("clamps to at least 1", () => {
    expect(autoCompactionThreshold(1000)).toBe(1);
  });

  test("returns null for 0 context window", () => {
    expect(autoCompactionThreshold(0)).toBeNull();
  });
});

describe("DEFAULT_CONTEXT_WINDOW", () => {
  test("is 128000", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(128000);
  });
});
