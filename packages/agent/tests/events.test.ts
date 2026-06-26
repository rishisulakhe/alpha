import { describe, expect, test } from "bun:test";
import { AgentEventSchema } from "../src/events.ts";
import type { AgentEvent } from "../src/events.ts";
import {
  isMessageEndEvent,
  isToolExecutionEndEvent,
  isToolExecutionStartEvent,
  isErrorEvent,
  isThinkingDeltaEvent,
  isMessageDeltaEvent,
  isTurnStartEvent,
  isTurnEndEvent,
} from "../src/events.ts";

// ---------------------------------------------------------------------------
// Type literal stability
// ---------------------------------------------------------------------------

describe("AgentEvent type literals", () => {
  test("each of the 14 event types has the correct type literal", () => {
    const events: AgentEvent[] = [
      { type: "agent_start" },
      { type: "agent_end" },
      { type: "turn_start", turn: 1 },
      { type: "turn_end", turn: 1 },
      { type: "retry", attempt: 1, maxAttempts: 3, delaySeconds: 0.5, message: "retrying" },
      { type: "queue_update", steering: ["s1"], followUp: ["f1"] },
      { type: "message_start", role: "assistant" },
      { type: "message_delta", text: "hello" },
      { type: "thinking_delta", text: "reasoning..." },
      { type: "message_end", message: { role: "user", content: "hi" } },
      { type: "tool_execution_start", call: { id: "c1", name: "read", arguments: {} } },
      { type: "tool_execution_update", message: "progress..." },
      { type: "tool_execution_end", result: { toolCallId: "c1", name: "read", ok: true, content: "done" } },
      { type: "error", message: "boom", recoverable: false },
    ];

    expect(events.map((e) => e.type)).toEqual([
      "agent_start",
      "agent_end",
      "turn_start",
      "turn_end",
      "retry",
      "queue_update",
      "message_start",
      "message_delta",
      "thinking_delta",
      "message_end",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
      "error",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trips
// ---------------------------------------------------------------------------

describe("AgentEvent serialization", () => {
  test("agent_start round-trips", () => {
    const parsed = AgentEventSchema.parse(JSON.parse(JSON.stringify({ type: "agent_start" })));
    expect(parsed.type).toBe("agent_start");
  });

  test("turn_start round-trips", () => {
    const parsed = AgentEventSchema.parse(JSON.parse(JSON.stringify({ type: "turn_start", turn: 3 })));
    expect(parsed.type).toBe("turn_start");
    if (parsed.type === "turn_start") expect(parsed.turn).toBe(3);
  });

  test("message_delta round-trips", () => {
    const parsed = AgentEventSchema.parse(JSON.parse(JSON.stringify({ type: "message_delta", text: "chunk" })));
    expect(parsed.type).toBe("message_delta");
    if (parsed.type === "message_delta") expect(parsed.text).toBe("chunk");
  });

  test("queue_update round-trips", () => {
    const parsed = AgentEventSchema.parse(JSON.parse(JSON.stringify({
      type: "queue_update",
      steering: ["adjust"],
      followUp: [],
    })));
    expect(parsed.type).toBe("queue_update");
    if (parsed.type === "queue_update") {
      expect(parsed.steering).toEqual(["adjust"]);
      expect(parsed.followUp).toEqual([]);
    }
  });

  test("error round-trips with statusCode", () => {
    const parsed = AgentEventSchema.parse(JSON.parse(JSON.stringify({
      type: "error",
      message: "failed",
      recoverable: true,
      statusCode: 429,
    })));
    expect(parsed.type).toBe("error");
    if (parsed.type === "error") {
      expect(parsed.recoverable).toBe(true);
      expect(parsed.statusCode).toBe(429);
    }
  });

  test("tool_execution_end round-trips with data/details/error", () => {
    const parsed = AgentEventSchema.parse(JSON.parse(JSON.stringify({
      type: "tool_execution_end",
      result: {
        toolCallId: "c2",
        name: "write",
        ok: false,
        content: "",
        error: "permission denied",
        data: { path: "/tmp/x" },
        details: { code: "EACCES" },
      },
    })));
    expect(parsed.type).toBe("tool_execution_end");
    if (parsed.type === "tool_execution_end") {
      expect(parsed.result.ok).toBe(false);
      expect(parsed.result.error).toBe("permission denied");
      expect(parsed.result.data).toEqual({ path: "/tmp/x" });
    }
  });
});

// ---------------------------------------------------------------------------
// Discriminated union parsing
// ---------------------------------------------------------------------------

describe("AgentEvent — discriminated union parsing", () => {
  test("parses agent_start from type", () => {
    const ev = AgentEventSchema.parse({ type: "agent_start" });
    expect(ev.type).toBe("agent_start");
  });

  test("parses turn_start from type", () => {
    const ev = AgentEventSchema.parse({ type: "turn_start", turn: 1 });
    expect(ev.type).toBe("turn_start");
  });

  test("parses message_delta from type", () => {
    const ev = AgentEventSchema.parse({ type: "message_delta", text: "hi" });
    expect(ev.type).toBe("message_delta");
  });

  test("parses message_end from type with user message", () => {
    const parsed = AgentEventSchema.parse({
      type: "message_end",
      message: { role: "user", content: "hello" },
    });
    expect(parsed.type).toBe("message_end");
    // TypeScript narrows automatically
    if (parsed.type === "message_end" && parsed.message.role === "user") {
      expect(parsed.message.content).toBe("hello");
    }
  });

  test("parses tool_execution_start from type", () => {
    const parsed = AgentEventSchema.parse({
      type: "tool_execution_start",
      call: { id: "c1", name: "read", arguments: { path: "a.txt" } },
    });
    expect(parsed.type).toBe("tool_execution_start");
  });

  test("rejects unknown event type", () => {
    expect(() => AgentEventSchema.parse({ type: "unknown", data: "x" })).toThrow();
  });

  test("rejects missing required field for specific variant", () => {
    expect(() => AgentEventSchema.parse({ type: "turn_start" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("type guards", () => {
  const makeEvent = (type: string): AgentEvent => {
    switch (type) {
      case "agent_start": return { type: "agent_start" };
      case "agent_end": return { type: "agent_end" };
      case "turn_start": return { type: "turn_start", turn: 1 };
      case "turn_end": return { type: "turn_end", turn: 1 };
      case "retry": return { type: "retry", attempt: 1, maxAttempts: 3, delaySeconds: 0, message: "r" };
      case "queue_update": return { type: "queue_update", steering: [], followUp: [] };
      case "message_start": return { type: "message_start", role: "assistant" };
      case "message_delta": return { type: "message_delta", text: "t" };
      case "thinking_delta": return { type: "thinking_delta", text: "t" };
      case "message_end": return { type: "message_end", message: { role: "user", content: "u" } };
      case "tool_execution_start": return { type: "tool_execution_start", call: { id: "c", name: "n", arguments: {} } };
      case "tool_execution_update": return { type: "tool_execution_update", message: "m" };
      case "tool_execution_end": return { type: "tool_execution_end", result: { toolCallId: "c", name: "n", ok: true, content: "" } };
      case "error": return { type: "error", message: "e", recoverable: false };
      default: return { type: "error", message: "bad", recoverable: false };
    }
  };

  test("isMessageEndEvent narrows correctly", () => {
    const ev = makeEvent("message_end");
    if (isMessageEndEvent(ev)) {
      expect(ev.message.role).toBe("user");
    } else {
      expect(false).toBe(true);
    }
  });

  test("isToolExecutionEndEvent narrows correctly", () => {
    const ev = makeEvent("tool_execution_end");
    if (isToolExecutionEndEvent(ev)) {
      expect(ev.result.ok).toBe(true);
    } else {
      expect(false).toBe(true);
    }
  });

  test("isToolExecutionStartEvent narrows correctly", () => {
    const ev = makeEvent("tool_execution_start");
    if (isToolExecutionStartEvent(ev)) {
      expect(ev.call.name).toBe("n");
    } else {
      expect(false).toBe(true);
    }
  });

  test("isErrorEvent narrows correctly", () => {
    const ev = makeEvent("error");
    if (isErrorEvent(ev)) {
      expect(ev.message).toBe("e");
    } else {
      expect(false).toBe(true);
    }
  });

  test("isThinkingDeltaEvent narrows correctly", () => {
    const ev = makeEvent("thinking_delta");
    if (isThinkingDeltaEvent(ev)) {
      expect(ev.text).toBe("t");
    } else {
      expect(false).toBe(true);
    }
  });

  test("isMessageDeltaEvent narrows correctly", () => {
    const ev = makeEvent("message_delta");
    if (isMessageDeltaEvent(ev)) {
      expect(ev.text).toBe("t");
    } else {
      expect(false).toBe(true);
    }
  });

  test("isTurnStartEvent narrows correctly", () => {
    const ev = makeEvent("turn_start");
    if (isTurnStartEvent(ev)) {
      expect(ev.turn).toBe(1);
    } else {
      expect(false).toBe(true);
    }
  });

  test("isTurnEndEvent narrows correctly", () => {
    const ev = makeEvent("turn_end");
    if (isTurnEndEvent(ev)) {
      expect(ev.turn).toBe(1);
    } else {
      expect(false).toBe(true);
    }
  });

  test("guards return false for wrong types", () => {
    const ev = makeEvent("message_delta");
    expect(isMessageEndEvent(ev)).toBe(false);
    expect(isToolExecutionEndEvent(ev)).toBe(false);
    expect(isErrorEvent(ev)).toBe(false);
    expect(isTurnStartEvent(ev)).toBe(false);
  });
});
