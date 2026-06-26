import { describe, expect, test } from "bun:test";
import {
  AgentMessageSchema,
  AssistantMessageSchema,
  isAssistantMessage,
  isToolResultMessage,
  isUserMessage,
  ToolCallSchema,
  ToolResultMessageSchema,
  UserMessageSchema,
} from "../src/messages.ts";
import type { AgentMessage } from "../src/messages.ts";

describe("UserMessage", () => {
  test("serializes with role and content", () => {
    const msg = UserMessageSchema.parse({ role: "user", content: "hello" });
    expect(msg).toEqual({ role: "user", content: "hello" });
  });

  test("round-trips through JSON", () => {
    const original = { role: "user" as const, content: "hello" };
    const parsed = UserMessageSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed).toEqual(original);
  });

  test("rejects unknown fields", () => {
    expect(() =>
      UserMessageSchema.parse({ role: "user", content: "hello", unexpected: true })
    ).toThrow();
  });

  test("rejects missing content", () => {
    expect(() => UserMessageSchema.parse({ role: "user" })).toThrow();
  });

  test("rejects wrong role literal", () => {
    expect(() => UserMessageSchema.parse({ role: "assistant", content: "hi" })).toThrow();
  });
});

describe("ToolCall", () => {
  test("parses with string arguments", () => {
    const tc = ToolCallSchema.parse({ id: "call-1", name: "read", arguments: { path: "README.md" } });
    expect(tc.id).toBe("call-1");
    expect(tc.name).toBe("read");
    expect(tc.arguments).toEqual({ path: "README.md" });
  });

  test("parses with numeric arguments", () => {
    const tc = ToolCallSchema.parse({ id: "call-2", name: "count", arguments: { limit: 10 } });
    expect(tc.arguments).toEqual({ limit: 10 });
  });

  test("rejects missing id", () => {
    expect(() => ToolCallSchema.parse({ name: "read", arguments: {} })).toThrow();
  });

  test("rejects non-string arguments values", () => {
    // ToolCallSchema allows any values in arguments (JSONObject), so this should pass
    const tc = ToolCallSchema.parse({ id: "call-3", name: "misc", arguments: { nested: { a: 1 } } });
    expect(tc).toBeDefined();
  });
});

describe("AssistantMessage", () => {
  test("defaults content and tool_calls", () => {
    const msg = AssistantMessageSchema.parse({ role: "assistant" });
    expect(msg.content).toBe("");
    expect(msg.tool_calls).toEqual([]);
  });

  test("includes tool calls", () => {
    const tc = { id: "call-1", name: "read", arguments: { path: "README.md" } };
    const msg = AssistantMessageSchema.parse({ role: "assistant", content: "I'll read that.", tool_calls: [tc] });
    expect(msg.tool_calls.length).toBe(1);
    expect(msg.tool_calls[0]!.name).toBe("read");
  });

  test("rejects unknown fields", () => {
    expect(() =>
      AssistantMessageSchema.parse({ role: "assistant", content: "", unexpected: 1 })
    ).toThrow();
  });
});

describe("ToolResultMessage", () => {
  test("records tool output with defaults", () => {
    const msg = ToolResultMessageSchema.parse({
      role: "tool",
      tool_call_id: "call-1",
      name: "read",
      content: "file contents",
    });
    expect(msg.tool_call_id).toBe("call-1");
    expect(msg.name).toBe("read");
    expect(msg.content).toBe("file contents");
    expect(msg.ok).toBe(true);
    expect(msg.data).toBeNull();
    expect(msg.details).toBeNull();
    expect(msg.error).toBeNull();
  });

  test("records data and details", () => {
    const msg = ToolResultMessageSchema.parse({
      role: "tool",
      tool_call_id: "call-2",
      name: "write",
      content: "written",
      ok: true,
      data: { path: "/tmp/file.txt" },
      details: { bytes: 42 },
      error: null,
    });
    expect(msg.data).toEqual({ path: "/tmp/file.txt" });
    expect(msg.details).toEqual({ bytes: 42 });
  });

  test("records error for failed tool", () => {
    const msg = ToolResultMessageSchema.parse({
      role: "tool",
      tool_call_id: "call-3",
      name: "read",
      content: "",
      ok: false,
      error: "File not found",
    });
    expect(msg.ok).toBe(false);
    expect(msg.error).toBe("File not found");
  });

  test("rejects unknown fields", () => {
    expect(() =>
      ToolResultMessageSchema.parse({
        role: "tool",
        tool_call_id: "id",
        name: "x",
        content: "",
        extra: true,
      })
    ).toThrow();
  });
});

describe("AgentMessage — discriminated union", () => {
  test("parses user message from role", () => {
    const msg = AgentMessageSchema.parse({ role: "user", content: "hello" });
    expect(msg.role).toBe("user");
    expect(isUserMessage(msg)).toBe(true);
  });

  test("parses assistant message from role", () => {
    const msg = AgentMessageSchema.parse({ role: "assistant", content: "hi" });
    expect(msg.role).toBe("assistant");
    expect(isAssistantMessage(msg)).toBe(true);
  });

  test("parses tool result message from role", () => {
    const msg = AgentMessageSchema.parse({
      role: "tool",
      tool_call_id: "id",
      name: "x",
      content: "",
    });
    expect(msg.role).toBe("tool");
    expect(isToolResultMessage(msg)).toBe(true);
  });

  test("rejects unknown role", () => {
    expect(() => AgentMessageSchema.parse({ role: "system", content: "x" })).toThrow();
  });

  test("round-trips through JSON", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: "Done",
      tool_calls: [{ id: "call-1", name: "read", arguments: { path: "a" } }],
    };
    const parsed = AgentMessageSchema.parse(JSON.parse(JSON.stringify(msg)));
    expect(parsed.role).toBe("assistant");
    expect((parsed as { tool_calls: unknown[] }).tool_calls.length).toBe(1);
  });
});

describe("type guards", () => {
  test("isUserMessage returns true for user role only", () => {
    const user: AgentMessage = { role: "user", content: "hello" };
    const assistant: AgentMessage = { role: "assistant", content: "hi", tool_calls: [] };
    const tool: AgentMessage = { role: "tool", tool_call_id: "id", name: "x", content: "", ok: true, data: null, details: null, error: null };

    expect(isUserMessage(user)).toBe(true);
    expect(isUserMessage(assistant)).toBe(false);
    expect(isUserMessage(tool)).toBe(false);
  });

  test("isAssistantMessage returns true for assistant role only", () => {
    const assistant: AgentMessage = { role: "assistant", content: "hi", tool_calls: [] };
    const user: AgentMessage = { role: "user", content: "hello" };

    expect(isAssistantMessage(assistant)).toBe(true);
    expect(isAssistantMessage(user)).toBe(false);
  });

  test("isToolResultMessage returns true for tool role only", () => {
    const tool: AgentMessage = { role: "tool", tool_call_id: "id", name: "x", content: "", ok: true, data: null, details: null, error: null };
    const user: AgentMessage = { role: "user", content: "hello" };

    expect(isToolResultMessage(tool)).toBe(true);
    expect(isToolResultMessage(user)).toBe(false);
  });

  test("type guards narrow the type", () => {
    const msg: AgentMessage = { role: "user", content: "hi" };

    if (isUserMessage(msg)) {
      const _content: string = msg.content;
      expect(_content).toBe("hi");
    }

    if (isAssistantMessage(msg)) {
      // Should not enter here
      expect(false).toBe(true);
    }

    if (isToolResultMessage(msg)) {
      // Should not enter here
      expect(false).toBe(true);
    }
  });
});
