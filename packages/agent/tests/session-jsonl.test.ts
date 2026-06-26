import { describe, expect, test } from "bun:test";
import { entryToJsonLine, entryFromJsonLine, entriesFromJsonLines } from "../src/session/jsonl.ts";
import type { SessionEntry } from "../src/session/entries.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<SessionEntry>): SessionEntry {
  return {
    type: "message",
    id: "test-1",
    parentId: null,
    timestamp: 1234567890,
    message: { role: "user", content: "hello" },
    ...overrides,
  } as SessionEntry;
}

// ---------------------------------------------------------------------------
// entryToJsonLine
// ---------------------------------------------------------------------------

describe("entryToJsonLine", () => {
  test("serializes entry as a single JSON line ending with newline", () => {
    const entry = makeEntry();
    const line = entryToJsonLine(entry);
    expect(line.endsWith("\n")).toBe(true);
    // Should not contain internal newlines
    const withoutNewline = line.slice(0, -1);
    expect(withoutNewline.includes("\n")).toBe(false);
  });

  test("produces valid JSON", () => {
    const entry = makeEntry();
    const line = entryToJsonLine(entry);
    const parsed = JSON.parse(line.trim());
    expect(parsed.type).toBe("message");
    expect(parsed.id).toBe("test-1");
  });
});

// ---------------------------------------------------------------------------
// entryFromJsonLine
// ---------------------------------------------------------------------------

describe("entryFromJsonLine", () => {
  test("parses a valid JSONL line back into the entry", () => {
    const entry = makeEntry();
    const line = entryToJsonLine(entry);
    const parsed = entryFromJsonLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("message");
    expect(parsed!.id).toBe("test-1");
  });

  test("round-trips: entry → line → entry", () => {
    const original: SessionEntry = {
      type: "message",
      id: "abc123",
      parentId: "parent-456",
      timestamp: 9876543210,
      message: { role: "assistant", content: "Hello!", tool_calls: [] },
    };
    const line = entryToJsonLine(original);
    const parsed = entryFromJsonLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("abc123");
    expect(parsed!.parentId).toBe("parent-456");
    if (parsed!.type === "message" && parsed!.message.role === "assistant") {
      expect(parsed!.message.content).toBe("Hello!");
    }
  });

  test("returns null for empty line", () => {
    expect(entryFromJsonLine("")).toBeNull();
    expect(entryFromJsonLine("   ")).toBeNull();
    expect(entryFromJsonLine("\n")).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(entryFromJsonLine("not json at all")).toBeNull();
    expect(entryFromJsonLine("{invalid")).toBeNull();
  });

  test("returns null for valid JSON that is not a session entry", () => {
    expect(entryFromJsonLine('{"type":"unknown","x":1}')).toBeNull();
    expect(entryFromJsonLine('{"foo":"bar"}')).toBeNull();
  });

  test("parses different entry types", () => {
    const entries: SessionEntry[] = [
      { type: "model_change", id: "1", parentId: null, timestamp: 1, model: "gpt-4" },
      { type: "leaf", id: "2", parentId: null, timestamp: 1, entryId: "abc" },
      { type: "label", id: "3", parentId: null, timestamp: 1, label: "My Label" },
      { type: "compaction", id: "4", parentId: null, timestamp: 1, summary: "s", replacesEntryIds: [] },
    ];

    for (const entry of entries) {
      const parsed = entryFromJsonLine(entryToJsonLine(entry));
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe(entry.type);
    }
  });
});

// ---------------------------------------------------------------------------
// entriesFromJsonLines
// ---------------------------------------------------------------------------

describe("entriesFromJsonLines", () => {
  test("parses multiple entries from newline-separated text", () => {
    const e1 = makeEntry({ id: "1" });
    const e2 = makeEntry({ id: "2" });
    const e3 = makeEntry({ id: "3" });

    const text = entryToJsonLine(e1) + entryToJsonLine(e2) + entryToJsonLine(e3);
    const entries = entriesFromJsonLines(text);

    expect(entries.length).toBe(3);
    expect(entries[0]!.id).toBe("1");
    expect(entries[1]!.id).toBe("2");
    expect(entries[2]!.id).toBe("3");
  });

  test("skips empty lines", () => {
    const e1 = makeEntry({ id: "a" });
    const e2 = makeEntry({ id: "b" });

    const text = entryToJsonLine(e1) + "\n\n" + entryToJsonLine(e2) + "\n  \n";
    const entries = entriesFromJsonLines(text);

    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toBe("a");
    expect(entries[1]!.id).toBe("b");
  });

  test("skips malformed lines gracefully", () => {
    const e1 = makeEntry({ id: "good" });
    const text = "bad line\n" + entryToJsonLine(e1) + "\n{invalid json\n" + '{"type":"bad","x":1}\n';
    const entries = entriesFromJsonLines(text);

    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("good");
  });

  test("returns empty array for empty text", () => {
    expect(entriesFromJsonLines("")).toEqual([]);
    expect(entriesFromJsonLines("\n\n\n")).toEqual([]);
  });
});
