import { describe, expect, test } from "bun:test";
import {
  ProviderErrorEventSchema,
  ProviderResponseEndEventSchema,
  ProviderResponseStartEventSchema,
  ProviderRetryEventSchema,
  ProviderTextDeltaEventSchema,
  ProviderThinkingDeltaEventSchema,
  ProviderToolCallEventSchema,
  ProviderEventSchema,
} from "../src/events.ts";
import type { ProviderEvent } from "../src/events.ts";

describe("ProviderResponseStartEvent", () => {
  test("has correct type and model", () => {
    const ev = ProviderResponseStartEventSchema.parse({ type: "response_start", model: "gpt-4" });
    expect(ev.type).toBe("response_start");
    expect(ev.model).toBe("gpt-4");
  });

  test("rejects unknown fields", () => {
    expect(() =>
      ProviderResponseStartEventSchema.parse({ type: "response_start", model: "gpt-4", extra: 1 })
    ).toThrow();
  });
});

describe("ProviderRetryEvent", () => {
  test("serializes with retry metadata", () => {
    const ev = ProviderRetryEventSchema.parse({
      type: "retry",
      attempt: 2,
      maxAttempts: 5,
      delaySeconds: 1.5,
      message: "Retrying after rate limit",
    });
    expect(ev.attempt).toBe(2);
    expect(ev.delaySeconds).toBe(1.5);
    expect(ev.message).toBe("Retrying after rate limit");
  });
});

describe("ProviderTextDeltaEvent", () => {
  test("carries text fragment", () => {
    const ev = ProviderTextDeltaEventSchema.parse({ type: "text_delta", text: "Hello" });
    expect(ev.type).toBe("text_delta");
    expect(ev.text).toBe("Hello");
  });

  test("supports empty string delta", () => {
    const ev = ProviderTextDeltaEventSchema.parse({ type: "text_delta", text: "" });
    expect(ev.text).toBe("");
  });
});

describe("ProviderThinkingDeltaEvent", () => {
  test("carries reasoning fragment", () => {
    const ev = ProviderThinkingDeltaEventSchema.parse({ type: "thinking_delta", text: "Let me think..." });
    expect(ev.type).toBe("thinking_delta");
    expect(ev.text).toBe("Let me think...");
  });
});

describe("ProviderToolCallEvent", () => {
  test("wraps a ToolCall", () => {
    const ev = ProviderToolCallEventSchema.parse({
      type: "tool_call",
      call: { id: "call-1", name: "read", arguments: { path: "file.txt" } },
    });
    expect(ev.type).toBe("tool_call");
    expect(ev.call.id).toBe("call-1");
    expect(ev.call.name).toBe("read");
    expect(ev.call.arguments).toEqual({ path: "file.txt" });
  });
});

describe("ProviderResponseEndEvent", () => {
  test("carries assistant message with finish reason", () => {
    const ev = ProviderResponseEndEventSchema.parse({
      type: "response_end",
      message: { role: "assistant", content: "Done" },
      finishReason: "stop",
    });
    expect(ev.type).toBe("response_end");
    expect(ev.message.role).toBe("assistant");
    expect(ev.finishReason).toBe("stop");
  });

  test("optionally carries usage metadata", () => {
    const ev = ProviderResponseEndEventSchema.parse({
      type: "response_end",
      message: { role: "assistant", content: "Done" },
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(ev.usage?.inputTokens).toBe(100);
    expect(ev.usage?.outputTokens).toBe(50);
  });

  test("carries assistant message with tool calls", () => {
    const ev = ProviderResponseEndEventSchema.parse({
      type: "response_end",
      message: {
        role: "assistant",
        content: "Let me read that.",
        tool_calls: [{ id: "call-1", name: "read", arguments: { path: "README.md" } }],
      },
      finishReason: "tool_use",
    });
    expect(ev.finishReason).toBe("tool_use");
    expect(ev.message.tool_calls[0]!.name).toBe("read");
  });
});

describe("ProviderErrorEvent", () => {
  test("carries error with recoverable flag", () => {
    const ev = ProviderErrorEventSchema.parse({
      type: "error",
      message: "Rate limit exceeded",
      recoverable: true,
    });
    expect(ev.type).toBe("error");
    expect(ev.message).toBe("Rate limit exceeded");
    expect(ev.recoverable).toBe(true);
    expect(ev.statusCode).toBeUndefined();
  });

  test("optionally carries HTTP status code", () => {
    const ev = ProviderErrorEventSchema.parse({
      type: "error",
      message: "Not found",
      statusCode: 404,
      recoverable: false,
    });
    expect(ev.statusCode).toBe(404);
    expect(ev.recoverable).toBe(false);
  });
});

describe("ProviderEvent — discriminated union", () => {
  test("parses response_start from type", () => {
    const ev = ProviderEventSchema.parse({ type: "response_start", model: "claude" });
    expect(ev.type).toBe("response_start");
  });

  test("parses text_delta from type", () => {
    const ev = ProviderEventSchema.parse({ type: "text_delta", text: "hi" });
    expect(ev.type).toBe("text_delta");
  });

  test("parses error from type", () => {
    const ev = ProviderEventSchema.parse({ type: "error", message: "fail", recoverable: false });
    expect(ev.type).toBe("error");
  });

  test("rejects unknown event type", () => {
    expect(() =>
      ProviderEventSchema.parse({ type: "unknown", data: "x" })
    ).toThrow();
  });

  test("round-trips through JSON", () => {
    const original: ProviderEvent = {
      type: "text_delta",
      text: "streaming chunk",
    };
    const parsed = ProviderEventSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed.type).toBe("text_delta");
    if (parsed.type === "text_delta") {
      expect(parsed.text).toBe("streaming chunk");
    }
  });
});

describe("all 7 event type names are stable", () => {
  test("each event has the correct type literal", () => {
    const events: ProviderEvent[] = [
      { type: "response_start", model: "m" },
      { type: "retry", attempt: 1, maxAttempts: 3, delaySeconds: 0.5, message: "retrying" },
      { type: "text_delta", text: "t" },
      { type: "thinking_delta", text: "th" },
      { type: "tool_call", call: { id: "c", name: "n", arguments: {} } },
      { type: "response_end", message: { role: "assistant", content: "d", tool_calls: [] }, finishReason: "stop" },
      { type: "error", message: "e", recoverable: false },
    ];

    expect(events.map((e) => e.type)).toEqual([
      "response_start",
      "retry",
      "text_delta",
      "thinking_delta",
      "tool_call",
      "response_end",
      "error",
    ]);
  });
});
