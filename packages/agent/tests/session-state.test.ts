import { describe, expect, test } from "bun:test";
import { fromEntries } from "../src/session/state.ts";
import type { SessionState } from "../src/session/state.ts";
import type { SessionEntry } from "../src/session/entries.ts";
import type { AgentMessage } from "../src/messages.ts";

// Helpers

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

// === normal conversation ===

describe("SessionState.fromEntries — normal conversation", () => {
  test("replays messages in order", () => {
    const entries: SessionEntry[] = [
      msg("a", null, "Hello"),
      msg("b", "a", "World!", "assistant"),
    ];
    const state = fromEntries(entries);
    expect(state.messages.length).toBe(2);
    const m0 = state.messages[0]!;
    const m1 = state.messages[1]!;
    expect(m0.role).toBe("user");
    expect(m1.role).toBe("assistant");
    if (m1.role === "assistant") {
      expect(m1.content).toBe("World!");
    }
  });

  test("replays only path when leafId is given", () => {
    const e1 = msg("a", null, "Root");
    const e2 = msg("b", "a", "Branch A child", "assistant");
    const l1 = leaf("l1", "b", "b");
    // Side branch (not on active path)
    const e3 = msg("c", "a", "Branch B child", "assistant");
    const l2 = leaf("l2", "c", "c");

    const entries = [e1, e2, l1, e3, l2];

    // Replay along l1's path (a → b → l1)
    const state = fromEntries(entries, "l1");
    expect(state.messages.length).toBe(2); // a + b only
    const sm0 = state.messages[0]!;
    const sm1 = state.messages[1]!;
    expect(sm0.role).toBe("user");
    expect(sm1.role).toBe("assistant");
    if (sm1.role === "assistant") {
      expect(sm1.content).toBe("Branch A child");
    }
  });
});

// === model / thinking changes ===

describe("SessionState.fromEntries — model and thinking changes", () => {
  test("tracks model from model_change entries", () => {
    const entries: SessionEntry[] = [
      { type: "model_change", id: "m", parentId: null, timestamp: 1, model: "gpt-4" },
      msg("a", "m", "Hi"),
    ];
    const state = fromEntries(entries);
    expect(state.model).toBe("gpt-4");
  });

  test("tracks thinking level", () => {
    const entries: SessionEntry[] = [
      { type: "thinking_level_change", id: "t", parentId: null, timestamp: 1, level: "high" },
      msg("a", "t", "Hi"),
    ];
    const state = fromEntries(entries);
    expect(state.thinkingLevel).toBe("high");
  });

  test("model is null when no model_change exists", () => {
    const entries = [msg("a", null, "Hi")];
    const state = fromEntries(entries);
    expect(state.model).toBeNull();
  });
});

// === compaction ===

describe("SessionState.fromEntries — compaction", () => {
  test("replaces message entries with summary", () => {
    const e1 = msg("a", null, "Question 1");
    const e2 = msg("b", "a", "Answer 1", "assistant");
    const e3 = msg("c", "b", "Question 2");
    const e4 = msg("d", "c", "Answer 2", "assistant");
    const comp: SessionEntry = {
      type: "compaction",
      id: "comp",
      parentId: "d",
      timestamp: 1,
      summary: "Resolved Q1 and answering Q2.",
      replacesEntryIds: ["a", "b"],
    };
    const e5 = msg("e", "comp", "Question 3");
    const e6 = msg("f", "e", "Answer 3", "assistant");

    const entries = [e1, e2, e3, e4, comp, e5, e6];
    const state = fromEntries(entries);

    // Should have: summary(for a+b) + c + d + e + f = 5 messages
    // a and b are replaced by the summary
    expect(state.messages.length).toBe(5);
    const sm0c = state.messages[0]!;
    expect(sm0c.role).toBe("user");
    if (sm0c.role === "user") {
      expect(sm0c.content).toContain("Previous conversation summary");
      expect(sm0c.content).toContain("Resolved Q1");
    }
    // c should still be present
    const sm1c = state.messages[1]!;
    expect(sm1c?.role).toBe("user");
    if (sm1c?.role === "user") {
      expect(sm1c.content).toBe("Question 2");
    }
  });

  test("collects compaction entries", () => {
    const comp: SessionEntry = {
      type: "compaction",
      id: "c1",
      parentId: null,
      timestamp: 1,
      summary: "Summary",
      replacesEntryIds: [],
    };
    const state = fromEntries([comp]);
    expect(state.compactionEntries.length).toBe(1);
    expect(state.compactionEntries[0]!.summary).toBe("Summary");
  });
});

// === branch summary ===

describe("SessionState.fromEntries — branch summary", () => {
  test("appends branch summary as synthetic user message", () => {
    const bsum: SessionEntry = {
      type: "branch_summary",
      id: "bs",
      parentId: null,
      timestamp: 1,
      summary: "This branch did X and Y.",
    };
    const entries = [bsum, msg("a", "bs", "Continuing...")];
    const state = fromEntries(entries);

    expect(state.messages.length).toBe(2);
    const bs0 = state.messages[0]!;
    expect(bs0.role).toBe("user");
    if (bs0.role === "user") {
      expect(bs0.content).toContain("summary of a branch");
      expect(bs0.content).toContain("This branch did X and Y");
    }
  });

  test("truncates entries before latest branch summary", () => {
    const oldMsg = msg("old", null, "Old stuff");
    const bsum: SessionEntry = {
      type: "branch_summary",
      id: "bs",
      parentId: "old",
      timestamp: 1,
      summary: "Summary of old.",
    };
    const newMsg = msg("new", "bs", "New stuff");

    const entries = [oldMsg, bsum, newMsg];
    const state = fromEntries(entries);

    // oldMsg should be truncated; only branch summary + newMsg remain
    expect(state.messages.length).toBe(2);
    expect(state.messages[0]?.role).toBe("user");
    if (state.messages[0]?.role === "user") {
      expect(state.messages[0].content).toContain("summary of a branch");
    }
    if (state.messages[1]?.role === "user") {
      expect(state.messages[1].content).toBe("New stuff");
    }
  });
});

// === session info and label ===

describe("SessionState.fromEntries — session info and label", () => {
  test("records session info", () => {
    const si: SessionEntry = {
      type: "session_info",
      id: "si",
      parentId: null,
      timestamp: 1,
      cwd: "/home/project",
      title: "My Session",
      createdAt: "2025-01-01T00:00:00Z",
    };
    const state = fromEntries([si]);
    expect(state.sessionInfo).not.toBeNull();
    expect(state.sessionInfo!.cwd).toBe("/home/project");
    expect(state.sessionInfo!.title).toBe("My Session");
  });

  test("records label", () => {
    const entries: SessionEntry[] = [
      { type: "label", id: "l", parentId: null, timestamp: 1, label: "Bug fix" },
    ];
    const state = fromEntries(entries);
    expect(state.label).toBe("Bug fix");
  });
});

// === active leaf tracking ===

describe("SessionState.fromEntries — active leaf", () => {
  test("activeLeafId from leaf entry", () => {
    const e1 = msg("a", null, "Root");
    const lf = leaf("l", "a", "a");
    const state = fromEntries([e1, lf]);
    expect(state.activeLeafId).toBe("a");
  });

  test("activeLeafId is null when no leaf entry exists", () => {
    const state = fromEntries([msg("a", null, "Hi")]);
    expect(state.activeLeafId).toBeNull();
  });
});
