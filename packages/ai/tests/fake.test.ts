import { describe, expect, test } from "bun:test";
import { FakeProvider } from "../src/fake.ts";
import type { ProviderEvent } from "../src/events.ts";
import type { CancellationToken } from "../src/provider.ts";

describe("FakeProvider — event replay", () => {
  test("replays events in order from the scripted stream", async () => {
    const stream: ProviderEvent[] = [
      { type: "response_start", model: "fake" },
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " World" },
      {
        type: "response_end",
        message: { role: "assistant", content: "Hello World", tool_calls: [] },
        finishReason: "stop",
      },
    ];

    const provider = new FakeProvider([stream]);
    const received: ProviderEvent[] = [];
    for await (const event of provider.streamResponse({
      model: "fake",
      system: "You are helpful.",
      messages: [],
      tools: [],
    })) {
      received.push(event);
    }

    expect(received).toEqual(stream);
  });

  test("consumes one stream per streamResponse() call", async () => {
    const stream1: ProviderEvent[] = [{ type: "response_start", model: "gpt-4" }];
    const stream2: ProviderEvent[] = [{ type: "response_start", model: "claude" }];

    const provider = new FakeProvider([stream1, stream2]);

    const r1: string[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      if (ev.type === "response_start") r1.push(ev.model);
    }

    const r2: string[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      if (ev.type === "response_start") r2.push(ev.model);
    }

    expect(r1).toEqual(["gpt-4"]);
    expect(r2).toEqual(["claude"]);
  });

  test("returns empty when no more streams are available", async () => {
    const provider = new FakeProvider([
      [{ type: "response_start", model: "once" }],
    ]);

    // First call consumes the only stream
    let count = 0;
    for await (const _ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      count++;
    }
    expect(count).toBe(1);

    // Second call has nothing
    let count2 = 0;
    for await (const _ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      count2++;
    }
    expect(count2).toBe(0);
  });
});

describe("FakeProvider — call recording", () => {
  test("records call arguments: model, system, messages, tools", async () => {
    const stream: ProviderEvent[] = [
      { type: "response_start", model: "fake" },
      {
        type: "response_end",
        message: { role: "assistant", content: "ok", tool_calls: [] },
        finishReason: "stop",
      },
    ];

    const provider = new FakeProvider([stream]);
    const messages = [{ role: "user" as const, content: "hello" }];
    const tools = [{ name: "echo", description: "Echo tool", inputSchema: {}, execute: async () => ({ toolCallId: "", name: "", ok: true, content: "" }) }];

    for await (const _ev of provider.streamResponse({
      model: "test-model",
      system: "test-system",
      messages,
      tools,
    })) {
      // consume
    }

    expect(provider.calls.length).toBe(1);
    const call = provider.calls[0]!;
    expect(call.model).toBe("test-model");
    expect(call.system).toBe("test-system");
    expect(call.messages).toEqual(messages);
    expect(call.tools).toEqual(tools);
    expect(call.tools.length).toBe(1);
  });

  test("records multiple calls in order", async () => {
    const stream: ProviderEvent[] = [
      {
        type: "response_end",
        message: { role: "assistant", content: "first", tool_calls: [] },
        finishReason: "stop",
      },
    ];

    const provider = new FakeProvider([stream, stream]);

    for await (const _ev of provider.streamResponse({ model: "m1", system: "", messages: [], tools: [] })) {}
    for await (const _ev of provider.streamResponse({ model: "m2", system: "", messages: [], tools: [] })) {}

    expect(provider.calls.length).toBe(2);
    expect(provider.calls[0]!.model).toBe("m1");
    expect(provider.calls[1]!.model).toBe("m2");
  });

  test("snapshots messages and tools (does not retain references)", async () => {
    const stream: ProviderEvent[] = [
      {
        type: "response_end",
        message: { role: "assistant", content: "ok", tool_calls: [] },
        finishReason: "stop",
      },
    ];
    const provider = new FakeProvider([stream]);

    const messages = [{ role: "user" as const, content: "hi" }];

    for await (const _ev of provider.streamResponse({ model: "m", system: "", messages, tools: [] })) {}

    // Mutate the original array — should not affect recorded call
    messages.push({ role: "user", content: "extra" });

    expect(provider.calls[0]!.messages.length).toBe(1);
    expect(provider.calls[0]!.messages[0]!.content).toBe("hi");
  });
});

describe("FakeProvider — cancellation", () => {
  test("stops yielding events when signal is cancelled", async () => {
    const stream: ProviderEvent[] = [
      { type: "text_delta", text: "A" },
      { type: "text_delta", text: "B" },
      { type: "text_delta", text: "C" },
    ];
    const provider = new FakeProvider([stream]);

    let cancelled = false;
    const signal: CancellationToken = {
      isCancelled: () => cancelled,
    };

    const received: string[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [], signal })) {
      received.push(ev.type === "text_delta" ? ev.text : "");
      if (received.length === 1) cancelled = true;
    }

    expect(received).toEqual(["A"]);
  });

  test("signal not provided — all events yielded", async () => {
    const stream: ProviderEvent[] = [
      { type: "text_delta", text: "A" },
      { type: "text_delta", text: "B" },
    ];
    const provider = new FakeProvider([stream]);

    const received: string[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      if (ev.type === "text_delta") received.push(ev.text);
    }

    expect(received).toEqual(["A", "B"]);
  });
});

describe("FakeProvider — static builders", () => {
  test("singleTextResponse creates a provider with one text turn", async () => {
    const provider = FakeProvider.singleTextResponse("Hello world");
    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      events.push(ev);
    }

    expect(events.length).toBe(3);
    expect(events[0]!.type).toBe("response_start");
    expect(events[1]!.type).toBe("text_delta");
    expect((events[1] as { text: string }).text).toBe("Hello world");
    expect(events[2]!.type).toBe("response_end");
    const last = events[2]!;
    if (last.type === "response_end") {
      expect(last.message.content).toBe("Hello world");
      expect(last.finishReason).toBe("stop");
    }
  });

  test("singleTextResponse accepts custom model and finishReason", async () => {
    const provider = FakeProvider.singleTextResponse("ok", { model: "custom-model", finishReason: "length" });
    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({ model: "x", system: "", messages: [], tools: [] })) {
      events.push(ev);
    }

    const first = events[0]!;
    const end = events[2]!;
    if (first.type === "response_start") expect(first.model).toBe("custom-model");
    if (end.type === "response_end") expect(end.finishReason).toBe("length");
  });

  test("singleToolCallResponse creates a two-turn provider", async () => {
    const toolCalls = [
      { id: "call-1", name: "read", arguments: { path: "a.txt" } },
    ];
    const provider = FakeProvider.singleToolCallResponse(toolCalls);

    // First turn — tool calls
    const turn1: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      turn1.push(ev);
    }

    // Should have tool_call events and response_end with tool_use finish
    expect(turn1.some((e) => e.type === "tool_call")).toBe(true);
    expect(turn1.some((e) => e.type === "response_end" && e.finishReason === "tool_use")).toBe(true);

    // Second turn — text response
    const turn2: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      turn2.push(ev);
    }
    expect(turn2.some((e) => e.type === "text_delta")).toBe(true);
    expect(turn2.some((e) => e.type === "response_end" && e.finishReason === "stop")).toBe(true);
  });

  test("singleToolCallResponse with custom final content", async () => {
    const provider = FakeProvider.singleToolCallResponse(
      [{ id: "c1", name: "read", arguments: {} }],
      { finalContent: "Custom done." },
    );

    // Consume first turn
    for await (const _ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {}
    // Consume second turn
    const turn2: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      turn2.push(ev);
    }

    const endEvent = turn2.find((e) => e.type === "response_end");
    expect(endEvent).toBeDefined();
    if (endEvent?.type === "response_end") {
      expect(endEvent.message.content).toBe("Custom done.");
    }
  });

  test("fromScript is equivalent to new FakeProvider", async () => {
    const stream: ProviderEvent[] = [{ type: "text_delta", text: "x" }];
    const p1 = FakeProvider.fromScript([stream]);
    const p2 = new FakeProvider([stream]);

    const r1: ProviderEvent[] = [];
    for await (const ev of p1.streamResponse({ model: "m", system: "", messages: [], tools: [] })) r1.push(ev);
    const r2: ProviderEvent[] = [];
    for await (const ev of p2.streamResponse({ model: "m", system: "", messages: [], tools: [] })) r2.push(ev);

    expect(r1).toEqual(r2);
  });
});

describe("FakeProvider — empty constructor", () => {
  test("empty FakeProvider yields no events", async () => {
    const provider = new FakeProvider();
    let count = 0;
    for await (const _ev of provider.streamResponse({ model: "m", system: "", messages: [], tools: [] })) {
      count++;
    }
    expect(count).toBe(0);
  });

  test("empty FakeProvider still records calls", async () => {
    const provider = new FakeProvider();
    for await (const _ev of provider.streamResponse({ model: "m", system: "s", messages: [], tools: [] })) {}
    expect(provider.calls.length).toBe(1);
  });
});
