import { describe, expect, test } from "bun:test";
import {
  SessionEntrySchema,
  MessageEntrySchema,
  ModelChangeEntrySchema,
  ThinkingLevelChangeEntrySchema,
  CompactionEntrySchema,
  BranchSummaryEntrySchema,
  LabelEntrySchema,
  LeafEntrySchema,
  SessionInfoEntrySchema,
  CustomEntrySchema,
  newEntryId,
} from "../src/session/entries.ts";
import type { SessionEntry } from "../src/session/entries.ts";

// ---------------------------------------------------------------------------

describe("MessageEntry", () => {
  test("serializes and deserializes with user message", () => {
    const entry = MessageEntrySchema.parse({
      type: "message",
      message: { role: "user", content: "hello" },
    });
    expect(entry.type).toBe("message");
    expect(entry.id).toBeTypeOf("string");
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.timestamp).toBeTypeOf("number");
    if (entry.message.role === "user") {
      expect(entry.message.content).toBe("hello");
    }
  });

  test("serializes with assistant message including tool calls", () => {
    const entry = MessageEntrySchema.parse({
      type: "message",
      message: {
        role: "assistant",
        content: "Let me read that.",
        tool_calls: [{ id: "c1", name: "read", arguments: { path: "file.txt" } }],
      },
    });
    expect(entry.type).toBe("message");
    const msg = entry.message;
    if (msg.role === "assistant") {
      expect(msg.tool_calls.length).toBe(1);
      expect(msg.tool_calls[0]!.name).toBe("read");
    }
  });

  test("serializes with tool result message", () => {
    const entry = MessageEntrySchema.parse({
      type: "message",
      message: {
        role: "tool",
        tool_call_id: "c1",
        name: "read",
        content: "file contents",
        ok: true,
        data: null,
        details: null,
        error: null,
      },
    });
    expect(entry.type).toBe("message");
    if (entry.message.role === "tool") {
      expect(entry.message.tool_call_id).toBe("c1");
    }
  });

  test("auto-generates id and timestamp", () => {
    const entry = MessageEntrySchema.parse({
      type: "message",
      message: { role: "user", content: "hi" },
    });
    expect(entry.id).toBeTypeOf("string");
    expect(entry.parentId).toBeNull();
    expect(entry.timestamp).toBeGreaterThan(0);
  });
});

describe("ModelChangeEntry", () => {
  test("records model with optional provider name", () => {
    const entry = ModelChangeEntrySchema.parse({
      type: "model_change",
      model: "gpt-4",
      providerName: "openai",
    });
    expect(entry.type).toBe("model_change");
    expect(entry.model).toBe("gpt-4");
    expect(entry.providerName).toBe("openai");
  });

  test("providerName is optional", () => {
    const entry = ModelChangeEntrySchema.parse({
      type: "model_change",
      model: "claude-sonnet",
    });
    expect(entry.providerName).toBeUndefined();
  });
});

describe("ThinkingLevelChangeEntry", () => {
  test("records thinking level", () => {
    const entry = ThinkingLevelChangeEntrySchema.parse({
      type: "thinking_level_change",
      level: "high",
    });
    expect(entry.level).toBe("high");
  });
});

describe("CompactionEntry", () => {
  test("records summary and replaced entry IDs", () => {
    const entry = CompactionEntrySchema.parse({
      type: "compaction",
      summary: "Conversation summarised.",
      replacesEntryIds: ["e1", "e2", "e3"],
    });
    expect(entry.summary).toBe("Conversation summarised.");
    expect(entry.replacesEntryIds).toEqual(["e1", "e2", "e3"]);
  });

  test("replacesEntryIds defaults to empty array", () => {
    const entry = CompactionEntrySchema.parse({
      type: "compaction",
      summary: "Empty replace.",
    });
    expect(entry.replacesEntryIds).toEqual([]);
  });
});

describe("BranchSummaryEntry", () => {
  test("records branch summary", () => {
    const entry = BranchSummaryEntrySchema.parse({
      type: "branch_summary",
      summary: "Branch A summary.",
    });
    expect(entry.summary).toBe("Branch A summary.");
  });
});

describe("LabelEntry", () => {
  test("records label", () => {
    const entry = LabelEntrySchema.parse({
      type: "label",
      label: "Bug fix session",
    });
    expect(entry.label).toBe("Bug fix session");
  });
});

describe("LeafEntry", () => {
  test("records active leaf entry ID", () => {
    const entry = LeafEntrySchema.parse({
      type: "leaf",
      entryId: "abc123",
    });
    expect(entry.entryId).toBe("abc123");
  });
});

describe("SessionInfoEntry", () => {
  test("records session metadata", () => {
    const entry = SessionInfoEntrySchema.parse({
      type: "session_info",
      cwd: "/home/user/project",
      title: "My Session",
      createdAt: "2025-01-15T10:30:00Z",
    });
    expect(entry.cwd).toBe("/home/user/project");
    expect(entry.title).toBe("My Session");
    expect(entry.createdAt).toBe("2025-01-15T10:30:00Z");
  });

  test("title is optional", () => {
    const entry = SessionInfoEntrySchema.parse({
      type: "session_info",
      cwd: "/tmp",
      createdAt: "2025-01-01T00:00:00Z",
    });
    expect(entry.title).toBeUndefined();
  });
});

describe("CustomEntry", () => {
  test("records namespace and JSON data", () => {
    const entry = CustomEntrySchema.parse({
      type: "custom",
      namespace: "my_plugin",
      data: { key: "value", count: 42 },
    });
    expect(entry.namespace).toBe("my_plugin");
    expect(entry.data).toEqual({ key: "value", count: 42 });
  });
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

describe("SessionEntry — discriminated union", () => {
  test("parses MessageEntry from type", () => {
    const entry = SessionEntrySchema.parse({
      type: "message",
      message: { role: "user", content: "hi" },
    });
    expect(entry.type).toBe("message");
  });

  test("parses CompactionEntry from type", () => {
    const entry = SessionEntrySchema.parse({
      type: "compaction",
      summary: "summary",
    });
    expect(entry.type).toBe("compaction");
  });

  test("parses LeafEntry from type", () => {
    const entry = SessionEntrySchema.parse({
      type: "leaf",
      entryId: "abc",
    });
    expect(entry.type).toBe("leaf");
  });

  test("rejects unknown entry type", () => {
    expect(() =>
      SessionEntrySchema.parse({ type: "unknown", data: "x" })
    ).toThrow();
  });

  test("round-trips through JSON", () => {
    const original: SessionEntry = {
      type: "label",
      id: "my-id",
      parentId: null,
      timestamp: 1234567890,
      label: "test-label",
    };
    const parsed = SessionEntrySchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed.type).toBe("label");
    if (parsed.type === "label") expect(parsed.label).toBe("test-label");
  });
});

// ---------------------------------------------------------------------------
// all 9 type literals
// ---------------------------------------------------------------------------

describe("all 9 entry type names are stable", () => {
  test("each entry has the correct type literal", () => {
    const entries: SessionEntry[] = [
      { type: "message", id: "1", parentId: null, timestamp: 1, message: { role: "user", content: "x" } },
      { type: "model_change", id: "2", parentId: null, timestamp: 1, model: "m" },
      { type: "thinking_level_change", id: "3", parentId: null, timestamp: 1, level: "medium" },
      { type: "compaction", id: "4", parentId: null, timestamp: 1, summary: "s", replacesEntryIds: [] },
      { type: "branch_summary", id: "5", parentId: null, timestamp: 1, summary: "s" },
      { type: "label", id: "6", parentId: null, timestamp: 1, label: "l" },
      { type: "leaf", id: "7", parentId: null, timestamp: 1, entryId: "e" },
      { type: "session_info", id: "8", parentId: null, timestamp: 1, cwd: "/", createdAt: "t" },
      { type: "custom", id: "9", parentId: null, timestamp: 1, namespace: "n", data: {} },
    ];

    expect(entries.map((e) => e.type)).toEqual([
      "message",
      "model_change",
      "thinking_level_change",
      "compaction",
      "branch_summary",
      "label",
      "leaf",
      "session_info",
      "custom",
    ]);
  });
});

// ---------------------------------------------------------------------------
// newEntryId
// ---------------------------------------------------------------------------

describe("newEntryId", () => {
  test("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newEntryId()));
    expect(ids.size).toBe(100);
  });

  test("returns a hex string", () => {
    const id = newEntryId();
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });
});
