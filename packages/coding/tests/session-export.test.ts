import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exportSessionJsonl,
  exportSessionHtml,
  exportSessionArtifact,
  normalizeExportFormat,
  renderSessionHtml,
  SessionExportError,
} from "../src/session-export.ts";
import type { SessionEntry, AgentMessage } from "@alpha/agent";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tempDir: string;

function makeEntry(type: string, overrides: Partial<SessionEntry> = {}): SessionEntry {
  const base: SessionEntry = {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    parentId: null,
    timestamp: Date.now() / 1000,
    type: "message",
    message: { role: "user", content: "Test" },
    ...overrides,
  } as SessionEntry;
  return base;
}

beforeEach(() => {
  tempDir = join(tmpdir(), `alpha-export-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// normalizeExportFormat tests
// ---------------------------------------------------------------------------

describe("normalizeExportFormat", () => {
  test("returns html for undefined", () => {
    expect(normalizeExportFormat(undefined)).toBe("html");
  });

  test("returns html for html variations", () => {
    expect(normalizeExportFormat("html")).toBe("html");
    expect(normalizeExportFormat("HTML")).toBe("html");
    expect(normalizeExportFormat(".html")).toBe("html");
    expect(normalizeExportFormat("htm")).toBe("html");
  });

  test("returns jsonl for jsonl variations", () => {
    expect(normalizeExportFormat("jsonl")).toBe("jsonl");
    expect(normalizeExportFormat("JSONL")).toBe("jsonl");
    expect(normalizeExportFormat(".jsonl")).toBe("jsonl");
  });

  test("throws for unsupported formats", () => {
    expect(() => normalizeExportFormat("pdf")).toThrow(SessionExportError);
  });
});

// ---------------------------------------------------------------------------
// exportSessionJsonl tests
// ---------------------------------------------------------------------------

describe("exportSessionJsonl", () => {
  test("writes JSONL file with entries", () => {
    const entries: SessionEntry[] = [
      makeEntry("message", { id: "msg-1", message: { role: "user", content: "Hello" } }),
      makeEntry("model_change", { id: "model-1", model: "gpt-4" } as SessionEntry),
    ];

    const outputPath = join(tempDir, "export.jsonl");
    const result = exportSessionJsonl(entries, outputPath);

    expect(result).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);

    const parsed1 = JSON.parse(lines[0]!);
    const parsed2 = JSON.parse(lines[1]!);
    expect(parsed1.id).toBe("msg-1");
    expect(parsed2.id).toBe("model-1");
  });

  test("handles empty entries", () => {
    const outputPath = join(tempDir, "empty.jsonl");
    exportSessionJsonl([], outputPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");
    expect(content).toBe("");
  });
});

// ---------------------------------------------------------------------------
// exportSessionHtml tests
// ---------------------------------------------------------------------------

describe("exportSessionHtml", () => {
  test("writes HTML file with entries", () => {
    const entries: SessionEntry[] = [
      makeEntry("message", { id: "msg-1", message: { role: "user", content: "Hello" } }),
    ];

    const outputPath = join(tempDir, "export.html");
    const result = exportSessionHtml(entries, outputPath);

    expect(result).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("<!doctype html>");
    expect(content).toContain("Session Tree");
    expect(content).toContain("Transcript Entries");
    expect(content).toContain("msg-1");
  });

  test("includes custom title and source", () => {
    const entries: SessionEntry[] = [
      makeEntry("message", { id: "msg-1", message: { role: "user", content: "Test" } }),
    ];

    const outputPath = join(tempDir, "custom.html");
    exportSessionHtml(entries, outputPath, {
      title: "Custom Title",
      source: "/path/to/session.jsonl",
    });

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("Custom Title");
    expect(content).toContain("/path/to/session.jsonl");
  });
});

// ---------------------------------------------------------------------------
// exportSessionArtifact tests
// ---------------------------------------------------------------------------

describe("exportSessionArtifact", () => {
  test("exports as HTML by default", () => {
    const entries: SessionEntry[] = [
      makeEntry("message", { id: "msg-1", message: { role: "user", content: "Hi" } }),
    ];

    const outputPath = join(tempDir, "artifact.html");
    exportSessionArtifact(entries, outputPath);

    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("<!doctype html>");
  });

  test("exports as JSONL when format specified", () => {
    const entries: SessionEntry[] = [
      makeEntry("message", { id: "msg-1", message: { role: "user", content: "Hi" } }),
    ];

    const outputPath = join(tempDir, "artifact.jsonl");
    exportSessionArtifact(entries, outputPath, { format: "jsonl" });

    const content = readFileSync(outputPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("msg-1");
  });
});

// ---------------------------------------------------------------------------
// renderSessionHtml tests
// ---------------------------------------------------------------------------

describe("renderSessionHtml", () => {
  test("renders empty session", () => {
    const html = renderSessionHtml([], { title: "Empty Session" });
    expect(html).toContain("Empty Session");
    expect(html).toContain("No entries");
  });

  test("renders message entries", () => {
    const entries: SessionEntry[] = [
      {
        id: "user-1",
        parentId: null,
        timestamp: Date.now() / 1000,
        type: "message",
        message: { role: "user", content: "Hello world" },
      },
      {
        id: "asst-1",
        parentId: "user-1",
        timestamp: Date.now() / 1000,
        type: "message",
        message: { role: "assistant", content: "Hi there!", tool_calls: [] },
      },
    ];

    const html = renderSessionHtml(entries, { title: "Test Session" });

    expect(html).toContain("Hello world");
    expect(html).toContain("Hi there!");
    expect(html).toContain("message:user");
    expect(html).toContain("message:assistant");
  });

  test("renders tool calls", () => {
    const entries: SessionEntry[] = [
      {
        id: "asst-1",
        parentId: null,
        timestamp: Date.now() / 1000,
        type: "message",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "tc-1", name: "read", arguments: { path: "/file.txt" } },
          ],
        },
      },
    ];

    const html = renderSessionHtml(entries, { title: "Tool Test" });

    expect(html).toContain("read");
    expect(html).toContain("tc-1");
    expect(html).toContain("Tool calls");
  });

  test("renders session info entry", () => {
    const entries: SessionEntry[] = [
      {
        id: "info-1",
        parentId: null,
        timestamp: Date.now() / 1000,
        type: "session_info",
        cwd: "/home/user/project",
        title: "My Session",
        createdAt: "2024-01-01T00:00:00Z",
      } as SessionEntry,
    ];

    const html = renderSessionHtml(entries, { title: "Info Test" });

    expect(html).toContain("My Session");
    expect(html).toContain("/home/user/project");
  });

  test("renders model change entry", () => {
    const entries: SessionEntry[] = [
      {
        id: "model-1",
        parentId: null,
        timestamp: Date.now() / 1000,
        type: "model_change",
        model: "gpt-4-turbo",
      } as SessionEntry,
    ];

    const html = renderSessionHtml(entries, { title: "Model Test" });

    expect(html).toContain("Model changed to");
    expect(html).toContain("gpt-4-turbo");
  });
});
