import { describe, expect, test } from "bun:test";
import { entriesById, pathToEntry, activeLeafId, branchableEntries } from "../src/session/tree.ts";
import type { SessionEntry } from "../src/session/entries.ts";
import type { AgentMessage } from "../src/messages.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(id: string, parentId: string | null, content: string, role: AgentMessage["role"] = "user"): SessionEntry {
  const message: AgentMessage = role === "user"
    ? { role: "user", content }
    : role === "assistant"
      ? { role: "assistant", content, tool_calls: [] }
      : { role: "tool", tool_call_id: "tc", name: "echo", content, ok: true, data: null, details: null, error: null };
  return { type: "message", id, parentId, timestamp: 1, message };
}

function leaf(id: string, parentId: string | null, entryId: string): SessionEntry {
  return { type: "leaf", id, parentId, timestamp: 1, entryId };
}

// ---------------------------------------------------------------------------
// entriesById
// ---------------------------------------------------------------------------

describe("entriesById", () => {
  test("indexes entries by id", () => {
    const e1 = msg("a", null, "first");
    const e2 = msg("b", "a", "second");
    const e3 = msg("c", "b", "third");
    const map = entriesById([e1, e2, e3]);
    expect(map.size).toBe(3);
    expect(map.get("a")).toBe(e1);
    expect(map.get("b")).toBe(e2);
    expect(map.get("c")).toBe(e3);
  });

  test("rejects duplicate ids", () => {
    const e1 = msg("dup", null, "first");
    const e2 = msg("dup", null, "second");
    expect(() => entriesById([e1, e2])).toThrow("Duplicate");
  });
});

// ---------------------------------------------------------------------------
// pathToEntry
// ---------------------------------------------------------------------------

describe("pathToEntry", () => {
  test("returns root-to-leaf path for a linear chain", () => {
    const e1 = msg("a", null, "root");
    const e2 = msg("b", "a", "child");
    const e3 = msg("c", "b", "grandchild");
    const lf = leaf("l", "c", "c");
    const entries = [e1, e2, e3, lf];

    const path = pathToEntry(entries, "l");
    expect(path.length).toBe(4);
    expect(path.map((e) => e.id)).toEqual(["a", "b", "c", "l"]);
  });

  test("works with leaf id pointing to a message entry", () => {
    const e1 = msg("a", null, "root");
    const e2 = msg("b", "a", "child");
    const lf = leaf("l", "b", "b");
    const entries = [e1, e2, lf];

    const path = pathToEntry(entries, "b");
    expect(path.length).toBe(2);
    expect(path.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("handles single-entry tree", () => {
    const e1 = msg("only", null, "one");
    const path = pathToEntry([e1], "only");
    expect(path.length).toBe(1);
    expect(path[0]!.id).toBe("only");
  });

  test("throws on missing entry", () => {
    const e1 = msg("a", null, "root");
    expect(() => pathToEntry([e1], "nonexistent")).toThrow("Missing");
  });

  test("detects cycles", () => {
    const e1: SessionEntry = { ...msg("a", "b", "first"), parentId: "b" };
    const e2: SessionEntry = { ...msg("b", "a", "second"), parentId: "a" };
    expect(() => pathToEntry([e1, e2], "a")).toThrow("Cycle");
  });
});

// ---------------------------------------------------------------------------
// activeLeafId
// ---------------------------------------------------------------------------

describe("activeLeafId", () => {
  test("returns null when no LeafEntry exists", () => {
    const entries = [msg("a", null, "hello")];
    expect(activeLeafId(entries)).toBeNull();
  });

  test("returns the entryId of the last LeafEntry", () => {
    const e1 = msg("a", null, "root");
    const lf1 = leaf("l1", "a", "a");
    const e2 = msg("b", "l1", "second");
    const lf2 = leaf("l2", "b", "b");
    const entries = [e1, lf1, e2, lf2];

    expect(activeLeafId(entries)).toBe("b");
  });

  test("returns entryId even if pointing to earlier entry", () => {
    const e1 = msg("a", null, "first");
    const e2 = msg("b", "a", "second");
    const lf = leaf("l", "b", "a"); // points back to "a"
    const entries = [e1, e2, lf];

    expect(activeLeafId(entries)).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// branchableEntries
// ---------------------------------------------------------------------------

describe("branchableEntries", () => {
  test("returns only message entries", () => {
    const e1 = msg("a", null, "user msg");
    const e2 = msg("b", "a", "assistant msg", "assistant");
    const mc = { type: "model_change", id: "m", parentId: "b", timestamp: 1, model: "gpt-4" } as SessionEntry;
    const lf = leaf("l", "m", "b");

    const branchable = branchableEntries([e1, e2, mc, lf]);
    expect(branchable.length).toBe(2);
    expect(branchable[0]!.id).toBe("a");
    expect(branchable[1]!.id).toBe("b");
  });

  test("returns empty array when no message entries exist", () => {
    const entries: SessionEntry[] = [
      { type: "session_info", id: "s", parentId: null, timestamp: 1, cwd: "/", createdAt: "t" },
      { type: "model_change", id: "m", parentId: "s", timestamp: 1, model: "gpt-4" },
    ];
    expect(branchableEntries(entries)).toEqual([]);
  });
});
