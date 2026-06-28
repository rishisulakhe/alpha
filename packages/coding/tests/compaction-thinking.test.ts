import { describe, expect, test } from "bun:test";
import { summarizeMessagesForCompaction, buildCompactionPrompt, buildUpdateCompactionPrompt, serializeMessagesForCompaction, recentPreservingCompactionPlan } from "../src/context/compaction.ts";
import { normalizeThinkingLevel, nextThinkingLevel, reasoningEffortForLevel, anthropicThinkingBudgetForLevel, providerThinkingLevels, type ThinkingLevel } from "../src/thinking.ts";
import type { AgentMessage } from "@alpha/agent";

// === Step 36: Compaction ===

describe("summarizeMessagesForCompaction", () => {
  test("produces deterministic fallback summary", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "Fix bug" },
      { role: "assistant", content: "I'll help.", tool_calls: [] },
    ];
    const result = summarizeMessagesForCompaction(msgs);
    expect(result).toContain("Automatically compacted 2 prior message(s)");
    expect(result).toContain("[User]: Fix bug");
    expect(result).toContain("[Assistant]: I'll help.");
  });

  test("truncates long messages", () => {
    const longContent = "a".repeat(300);
    const msgs: AgentMessage[] = [{ role: "user", content: longContent }];
    const result = summarizeMessagesForCompaction(msgs);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(longContent.length + 50);
  });
});

describe("serializeMessagesForCompaction", () => {
  test("serializes messages as XML-like format", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!", tool_calls: [] },
    ];
    const result = serializeMessagesForCompaction(msgs);
    expect(result).toContain('<message role="user">');
    expect(result).toContain("Hello");
    expect(result).toContain('<message role="assistant">');
  });

  test("includes tool calls in serialization", () => {
    const msgs: AgentMessage[] = [{
      role: "assistant",
      content: "Let me read.",
      tool_calls: [{ id: "c1", name: "read", arguments: { path: "file.txt" } }],
    }];
    const result = serializeMessagesForCompaction(msgs);
    expect(result).toContain('<tool_call');
    expect(result).toContain('name="read"');
  });
});

describe("buildCompactionPrompt", () => {
  test("builds PI-format prompt", () => {
    const msgs: AgentMessage[] = [{ role: "user", content: "Help" }];
    const result = buildCompactionPrompt(msgs);
    expect(result).toContain("<conversation>");
    expect(result).toContain("</conversation>");
    expect(result).toContain("## Goal");
    expect(result).toContain("## Constraints");
    expect(result).toContain("## Progress");
    expect(result).toContain("## Key Decisions");
    expect(result).toContain("## Next Steps");
    expect(result).toContain("## Critical Context");
  });

  test("includes custom instructions", () => {
    const result = buildCompactionPrompt([{ role: "user", content: "X" }], "Focus on bugs");
    expect(result).toContain("Focus on bugs");
  });
});

describe("buildUpdateCompactionPrompt", () => {
  test("wraps previous summary in tags", () => {
    const result = buildUpdateCompactionPrompt("Prior summary.", [
      { role: "user", content: "New message" },
    ]);
    expect(result).toContain("<previous-summary>");
    expect(result).toContain("Prior summary.");
    expect(result).toContain("</previous-summary>");
    expect(result).toContain("Update the summary");
  });
});

describe("recentPreservingCompactionPlan", () => {
  test("keeps recent messages within token budget", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "old" },
      { role: "user", content: "new" },
    ];
    const plan = recentPreservingCompactionPlan(msgs, 10);
    expect(plan.keep.length).toBeGreaterThanOrEqual(1);
    // Newest message should be in keep
    expect(plan.keep.some((m) => m.content === "new")).toBe(true);
  });

  test("compacts old messages when over budget", () => {
    const largeMsg: AgentMessage = { role: "user", content: "a".repeat(1000) };
    const smallMsg: AgentMessage = { role: "user", content: "b" };
    const msgs = [largeMsg, smallMsg];
    const plan = recentPreservingCompactionPlan(msgs, 10);
    expect(plan.keep.length).toBe(1); // only the small "b" fits
    expect(plan.keep[0]!.content).toBe("b");
  });
});

// === Step 37: Thinking ===

describe("normalizeThinkingLevel", () => {
  test("case-insensitive normalization", () => {
    expect(normalizeThinkingLevel("HIGH")).toBe("high");
    expect(normalizeThinkingLevel("Off")).toBe("off");
  });

  test("undefined returns default", () => {
    expect(normalizeThinkingLevel(undefined)).toBe("medium");
    expect(normalizeThinkingLevel(undefined, "low")).toBe("low");
  });

  test("throws on unknown level", () => {
    expect(() => normalizeThinkingLevel("maximum")).toThrow();
  });
});

describe("nextThinkingLevel", () => {
  test("cycles forward", () => {
    const levels: ThinkingLevel[] = ["off", "low", "high"];
    expect(nextThinkingLevel("off", levels)).toBe("low");
    expect(nextThinkingLevel("low", levels)).toBe("high");
  });

  test("wraps around", () => {
    const levels: ThinkingLevel[] = ["off", "low", "high"];
    expect(nextThinkingLevel("high", levels)).toBe("off");
  });
});

describe("reasoningEffortForLevel", () => {
  test("off maps to none", () => {
    expect(reasoningEffortForLevel("off")).toBe("none");
  });

  test("other levels map as-is", () => {
    expect(reasoningEffortForLevel("low")).toBe("low");
    expect(reasoningEffortForLevel("xhigh")).toBe("xhigh");
  });
});

describe("anthropicThinkingBudgetForLevel", () => {
  test("off returns null", () => {
    expect(anthropicThinkingBudgetForLevel("off")).toBeNull();
  });

  test("maps to token budgets", () => {
    expect(anthropicThinkingBudgetForLevel("minimal")).toBe(1024);
    expect(anthropicThinkingBudgetForLevel("low")).toBe(2048);
    expect(anthropicThinkingBudgetForLevel("medium")).toBe(4096);
    expect(anthropicThinkingBudgetForLevel("high")).toBe(8192);
    expect(anthropicThinkingBudgetForLevel("xhigh")).toBe(16384);
  });
});

describe("providerThinkingLevels", () => {
  test("filters to known thinking levels", () => {
    const result = providerThinkingLevels(["off", "low", "high", "invalid"]);
    expect(result).toEqual(["off", "low", "high"]);
  });

  test("returns empty for empty or undefined input", () => {
    expect(providerThinkingLevels([])).toEqual([]);
    expect(providerThinkingLevels(undefined)).toEqual([]);
  });
});
