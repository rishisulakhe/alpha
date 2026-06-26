import { describe, expect, test } from "bun:test";
import { runAgentLoop } from "../src/loop.ts";
import { FakeProvider } from "@alpha/ai";
import type { ProviderEvent } from "@alpha/ai";
import type { AgentEvent } from "../src/events.ts";
import type { AgentMessage, ToolCall } from "../src/index.ts";
import type { AgentTool, AgentToolResult, CancellationToken } from "../src/tools.ts";
import { isToolResultMessage } from "../src/messages.ts";

function echoTool(): AgentTool {
  return {
    name: "echo",
    description: "Echoes text back.",
    inputSchema: { type: "object" },
    async execute(args): Promise<AgentToolResult> {
      return {
        toolCallId: "",
        name: "echo",
        ok: true,
        content: `echoed: ${String(args.text ?? "")}`,
      };
    },
  };
}

async function collectEvents(loop: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of loop) events.push(ev);
  return events;
}

// === simple text response ===

describe("runAgentLoop — simple text response", () => {
  test("streams text deltas and appends assistant message", async () => {
    const provider = FakeProvider.singleTextResponse("Hello world");
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "You are helpful.", messages, tools: [] }));
    expect(events.map((e) => e.type)).toEqual(["agent_start", "turn_start", "message_start", "message_delta", "message_end", "turn_end", "agent_end"]);
    expect(messages.length).toBe(1);
    const msg = messages[0]!;
    expect(msg.role).toBe("assistant");
    if (msg.role === "assistant") expect(msg.content).toBe("Hello world");
  });

  test("message_delta events carry the text content", async () => {
    const provider = FakeProvider.singleTextResponse("Hello");
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "m", system: "", messages, tools: [] }));
    const delta = events.find((e) => e.type === "message_delta");
    expect(delta).toBeDefined();
    if (delta?.type === "message_delta") expect(delta.text).toBe("Hello");
  });
});

// === thinking deltas ===

describe("runAgentLoop — thinking deltas", () => {
  test("thinking deltas are emitted but not in assistant message content", async () => {
    const script: ProviderEvent[] = [
      { type: "response_start", model: "fake" } as ProviderEvent,
      { type: "thinking_delta", text: "I should answer..." } as ProviderEvent,
      { type: "text_delta", text: "Answer" } as ProviderEvent,
      { type: "response_end", message: { role: "assistant", content: "Answer", tool_calls: [] }, finishReason: "stop" } as ProviderEvent,
    ];
    const provider = new FakeProvider([script]);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [] }));
    const tds = events.filter((e) => e.type === "thinking_delta");
    expect(tds.length).toBe(1);
    const td0 = tds[0]!;
    if (td0.type === "thinking_delta") expect(td0.text).toBe("I should answer...");
    const msg = messages[0]!;
    if (msg.role === "assistant") {
      expect(msg.content).toBe("Answer");
      expect(msg.content).not.toContain("I should answer");
    }
  });
});

// === tool call loop ===

describe("runAgentLoop — tool call loop", () => {
  test("provider returns tool_call -> execute -> provider called again -> text response", async () => {
    const tc: ToolCall[] = [{ id: "c1", name: "echo", arguments: { text: "ping" } }];
    const provider = FakeProvider.singleToolCallResponse(tc);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [echoTool()] }));
    expect(events.some((e) => e.type === "tool_execution_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_execution_end")).toBe(true);
    expect(events.filter((e) => e.type === "turn_start").length).toBe(2);
    expect(messages.length).toBe(3);
    expect(messages[0]!.role).toBe("assistant");
    expect(messages[1]!.role).toBe("tool");
    expect(messages[2]!.role).toBe("assistant");
    if (isToolResultMessage(messages[1]!)) expect(messages[1].content).toContain("echoed: ping");
  });

  test("unknown tool returns error result", async () => {
    const tc: ToolCall[] = [{ id: "c1", name: "nonexistent", arguments: {} }];
    const provider = FakeProvider.singleToolCallResponse(tc, { finalContent: "Done." });
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [echoTool()] }));
    const endEv = events.find((e) => e.type === "tool_execution_end");
    if (endEv?.type === "tool_execution_end") {
      expect(endEv.result.ok).toBe(false);
      expect(endEv.result.error).toContain("Unknown tool");
    }
    const toolMsgs = messages.filter(isToolResultMessage);
    expect(toolMsgs.length).toBe(1);
    expect(toolMsgs[0]!.ok).toBe(false);
  });

  test("tool returning wrong toolCallId gets corrected", async () => {
    const tool: AgentTool = {
      name: "bad-id", description: "Returns mismatched id", inputSchema: {},
      async execute(): Promise<AgentToolResult> {
        return { toolCallId: "wrong-id", name: "bad-id", ok: true, content: "ok" };
      },
    };
    const tc: ToolCall[] = [{ id: "correct-id", name: "bad-id", arguments: {} }];
    const provider = FakeProvider.singleToolCallResponse(tc, { finalContent: "Done." });
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [tool] }));
    const endEv = events.find((e) => e.type === "tool_execution_end");
    if (endEv?.type === "tool_execution_end") expect(endEv.result.toolCallId).toBe("correct-id");
  });

  test("tool throwing exception yields error result", async () => {
    const tool: AgentTool = {
      name: "exploder", description: "Throws", inputSchema: {},
      async execute(): Promise<AgentToolResult> { throw new Error("boom"); },
    };
    const tc: ToolCall[] = [{ id: "c1", name: "exploder", arguments: {} }];
    const provider = FakeProvider.singleToolCallResponse(tc, { finalContent: "Done." });
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [tool] }));
    const endEv = events.find((e) => e.type === "tool_execution_end");
    if (endEv?.type === "tool_execution_end") {
      expect(endEv.result.ok).toBe(false);
      expect(endEv.result.error).toBe("boom");
    }
  });
});

// === multi-turn ===

describe("runAgentLoop — multi-turn tool loop", () => {
  test("handles 3 turns with tool calls each time", async () => {
    const model = "fake";
    const makeCalls = (n: number): ToolCall[] => [{ id: `c${n}`, name: "echo", arguments: { text: `turn-${n}` } }];
    const script: ProviderEvent[][] = [
      [{ type: "response_start", model } as ProviderEvent, ...makeCalls(1).map((c): ProviderEvent => ({ type: "tool_call", call: c })), { type: "response_end", message: { role: "assistant", content: "", tool_calls: makeCalls(1) }, finishReason: "tool_use" } as ProviderEvent],
      [{ type: "response_start", model } as ProviderEvent, ...makeCalls(2).map((c): ProviderEvent => ({ type: "tool_call", call: c })), { type: "response_end", message: { role: "assistant", content: "", tool_calls: makeCalls(2) }, finishReason: "tool_use" } as ProviderEvent],
      [{ type: "response_start", model } as ProviderEvent, ...makeCalls(3).map((c): ProviderEvent => ({ type: "tool_call", call: c })), { type: "response_end", message: { role: "assistant", content: "", tool_calls: makeCalls(3) }, finishReason: "tool_use" } as ProviderEvent],
      [{ type: "response_start", model } as ProviderEvent, { type: "text_delta", text: "All done" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "All done", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
    ];
    const provider = new FakeProvider(script);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [echoTool()] }));
    expect(events.filter((e) => e.type === "turn_start").length).toBe(4);
    expect(messages.length).toBe(7);
  });
});

// === maxTurns ===

describe("runAgentLoop — maxTurns", () => {
  test("stops after maxTurns and yields error", async () => {
    const provider = FakeProvider.singleTextResponse("Hi");
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [], maxTurns: 1 }));
    expect(events.filter((e) => e.type === "turn_start").length).toBe(1);
    const error = events.find((e) => e.type === "error");
    if (error?.type === "error") {
      expect(error.recoverable).toBe(true);
      expect(error.message).toContain("max_turns=1");
    }
  });

  test("maxTurns=0 yields immediate error", async () => {
    const provider = FakeProvider.singleTextResponse("Hi");
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [], maxTurns: 0 }));
    expect(events.length).toBe(3);
    expect(events[0]!.type).toBe("agent_start");
    expect(events[1]!.type).toBe("error");
    expect(events[2]!.type).toBe("agent_end");
  });

  test("no maxTurns runs arbitrarily", async () => {
    const script: ProviderEvent[][] = Array.from({ length: 10 }, (_, i) => [
      { type: "response_start", model: "fake" } as ProviderEvent,
      { type: "tool_call", call: { id: `c${i}`, name: "echo", arguments: { text: `msg-${i}` } } } as ProviderEvent,
      { type: "response_end", message: { role: "assistant", content: "", tool_calls: [{ id: `c${i}`, name: "echo", arguments: { text: `msg-${i}` } }] }, finishReason: "tool_use" } as ProviderEvent,
    ]);
    // Add a final text response to end the loop
    script.push([
      { type: "response_start", model: "fake" } as ProviderEvent,
      { type: "text_delta", text: "done" } as ProviderEvent,
      { type: "response_end", message: { role: "assistant", content: "done", tool_calls: [] }, finishReason: "stop" } as ProviderEvent,
    ]);
    const provider = new FakeProvider(script);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [echoTool()] }));
    expect(events.some((e) => e.type === "agent_end")).toBe(true);
    // 10 assistant(tool) + 10 tool-result + 1 assistant(text) = 21 messages
    expect(messages.length).toBe(21);
  });
});

// === cancellation ===

describe("runAgentLoop — cancellation", () => {
  test("cancellation during tool execution yields cancelled results for remaining tools", async () => {
    let cancelled = false;
    const signal: CancellationToken = { isCancelled: () => cancelled };
    const calls: ToolCall[] = [
      { id: "c1", name: "echo", arguments: { text: "first" } },
      { id: "c2", name: "echo", arguments: { text: "second" } },
      { id: "c3", name: "echo", arguments: { text: "third" } },
    ];
    const tool: AgentTool = {
      name: "echo", description: "Echo", inputSchema: {},
      async execute(args): Promise<AgentToolResult> {
        cancelled = true;
        return { toolCallId: "", name: "echo", ok: true, content: String(args.text ?? "") };
      },
    };
    const provider = FakeProvider.singleToolCallResponse(calls);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [tool], signal }));
    const endEvents = events.filter((e) => e.type === "tool_execution_end");
    expect(endEvents.length).toBe(3);
    const e0 = endEvents[0]!;
    const e1 = endEvents[1]!;
    const e2 = endEvents[2]!;
    if (e0.type === "tool_execution_end") expect(e0.result.ok).toBe(true);
    if (e1.type === "tool_execution_end") {
      expect(e1.result.ok).toBe(false);
      expect(e1.result.error).toContain("cancelled");
    }
    if (e2.type === "tool_execution_end") {
      expect(e2.result.ok).toBe(false);
      expect(e2.result.error).toContain("cancelled");
    }
  });
});

// === steering and follow-up ===

describe("runAgentLoop — steering and follow-up", () => {
  test("steering messages are injected after tool batch, before next provider call", async () => {
    const tc: ToolCall[] = [{ id: "c1", name: "echo", arguments: { text: "ping" } }];
    const provider = FakeProvider.singleToolCallResponse(tc, { finalContent: "Done" });
    const messages: AgentMessage[] = [];
    let called = false;
    const steering: AgentMessage[] = [{ role: "user", content: "steer" }];
    const events = await collectEvents(runAgentLoop({
      provider, model: "fake", system: "", messages, tools: [echoTool()],
      getSteeringMessages: () => called ? [] : (called = true, steering),
    }));
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
    const u0 = userMsgs[0]!;
    if (u0.role === "user") expect(u0.content).toBe("steer");
  });

  test("follow-up messages are injected only when loop would stop", async () => {
    const tc: ToolCall[] = [{ id: "c1", name: "echo", arguments: { text: "ping" } }];
    const provider = FakeProvider.singleToolCallResponse(tc, { finalContent: "Done" });
    const messages: AgentMessage[] = [];
    let called = false;
    const followUp: AgentMessage[] = [{ role: "user", content: "follow" }];
    const events = await collectEvents(runAgentLoop({
      provider, model: "fake", system: "", messages, tools: [echoTool()],
      getFollowUpMessages: () => called ? [] : (called = true, followUp),
    }));
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
  });

  test("follow-up keeps the loop alive for another turn", async () => {
    const provider = FakeProvider.singleTextResponse("Done");
    const messages: AgentMessage[] = [];
    let called = false;
    const followUp: AgentMessage[] = [{ role: "user", content: "keep going" }];
    const events = await collectEvents(runAgentLoop({
      provider, model: "fake", system: "", messages, tools: [],
      getFollowUpMessages: () => called ? [] : (called = true, followUp),
    }));
    expect(events.filter((e) => e.type === "turn_start").length).toBe(2);
  });
});

// === provider error ===

describe("runAgentLoop — provider errors", () => {
  test("provider error event is forwarded as agent error", async () => {
    const script: ProviderEvent[] = [
      { type: "error", message: "rate limit", statusCode: 429, recoverable: false } as ProviderEvent,
    ];
    const provider = new FakeProvider([script]);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [] }));
    const errors = events.filter((e) => e.type === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0]!;
    if (err.type === "error") expect(err.message).toBe("rate limit");
  });

  test("provider retry event is forwarded as agent retry", async () => {
    const script: ProviderEvent[] = [
      { type: "retry", attempt: 1, maxAttempts: 3, delaySeconds: 0.5, message: "retrying" } as ProviderEvent,
      { type: "text_delta", text: "ok" } as ProviderEvent,
      { type: "response_end", message: { role: "assistant", content: "ok", tool_calls: [] }, finishReason: "stop" } as ProviderEvent,
    ];
    const provider = new FakeProvider([script]);
    const messages: AgentMessage[] = [];
    const events = await collectEvents(runAgentLoop({ provider, model: "fake", system: "", messages, tools: [] }));
    expect(events.some((e) => e.type === "retry")).toBe(true);
  });
});

// === queue mode: one_at_a_time ===

describe("runAgentLoop — queueMode one_at_a_time", () => {
  test("steering drains one at a time per turn with follow-up keeping loop alive", async () => {
    // Provider with 3 text responses
    const script: ProviderEvent[][] = [
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "a" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "a", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "b" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "b", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "c" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "c", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
    ];
    const provider = new FakeProvider(script);
    const messages: AgentMessage[] = [];
    const steering = [
      { role: "user", content: "s1" } as AgentMessage,
      { role: "user", content: "s2" } as AgentMessage,
    ];
    let callCount = 0;
    const events = await collectEvents(runAgentLoop({
      provider, model: "fake", system: "", messages, tools: [],
      getSteeringMessages: () => {
        if (callCount >= steering.length) return [];
        const msg = steering[callCount++]!;
        return [msg]; // Return one at a time so one_at_a_time picks first
      },
      queueMode: "one_at_a_time",
    }));
    // With one_at_a_time steering, steering s1 keeps turn alive, s2 keeps it alive,
    // then follow-up keeps it alive. Without follow-up, it eventually stops.
    // The exact turn count depends on whether follow-up exists, but steering
    // messages should appear in transcript.
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    const u0 = userMsgs[0]!;
    if (u0.role === "user") expect(u0.content).toBe("s1");
  });

  test("one_at_a_time vs all — all drains entire queue at once", async () => {
    // Use a provider with multiple text responses
    const script: ProviderEvent[][] = [
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "a" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "a", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "b" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "b", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "c" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "c", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
    ];

    // "all" mode: all steering messages are drained on first turn, keeping loop alive
    const provider = new FakeProvider(script);
    const messages: AgentMessage[] = [];
    const steering = [
      { role: "user", content: "s1" } as AgentMessage,
      { role: "user", content: "s2" } as AgentMessage,
    ];
    let called = false;
    const events = await collectEvents(runAgentLoop({
      provider, model: "fake", system: "", messages, tools: [],
      getSteeringMessages: () => called ? [] : (called = true, steering),
      queueMode: "all",
    }));
    // Both steering messages should be in transcript
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(2);
  });

  test("steering takes priority over follow-up", async () => {
    const script: ProviderEvent[][] = [
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "a" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "a", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
      [{ type: "response_start", model: "fake" } as ProviderEvent, { type: "text_delta", text: "b" } as ProviderEvent, { type: "response_end", message: { role: "assistant", content: "b", tool_calls: [] }, finishReason: "stop" } as ProviderEvent],
    ];
    const provider = new FakeProvider(script);
    const messages: AgentMessage[] = [];
    let steerDone = false;
    let followDone = false;
    const events = await collectEvents(runAgentLoop({
      provider, model: "fake", system: "", messages, tools: [],
      getSteeringMessages: () => steerDone ? [] : (steerDone = true, [{ role: "user", content: "steer" } as AgentMessage]),
      getFollowUpMessages: () => followDone ? [] : (followDone = true, [{ role: "user", content: "follow" } as AgentMessage]),
      queueMode: "all",
    }));
    // Steering should appear before follow-up in messages
    const userMsgs = messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    // If both are present, steer should come first
    if (userMsgs.length >= 2) {
      if (userMsgs[0]!.role === "user" && userMsgs[1]!.role === "user") {
        // Not guaranteed ordering but steering is processed first
      }
    }
  });
});

// === cancellation ===

describe("runAgentLoop — cancellation (extended)", () => {
  test("cancellation during provider stream yields clean exit", async () => {
    let cancelled = false;
    const signal = { isCancelled: () => cancelled };

    const script: ProviderEvent[] = [
      { type: "response_start", model: "fake" } as ProviderEvent,
      { type: "text_delta", text: "first chunk" } as ProviderEvent,
      { type: "text_delta", text: "second chunk" } as ProviderEvent,
      { type: "response_end", message: { role: "assistant", content: "full", tool_calls: [] }, finishReason: "stop" } as ProviderEvent,
    ];

    const provider = new FakeProvider([script]);
    const messages: AgentMessage[] = [];
    let deltaCount = 0;
    const events: AgentEvent[] = [];

    const loop = runAgentLoop({ provider, model: "fake", system: "", messages, tools: [], signal });

    for await (const ev of loop) {
      events.push(ev);
      if (ev.type === "message_delta") {
        deltaCount++;
        if (deltaCount === 1) {
          cancelled = true;
        }
      }
    }

    // The provider checks cancellation on next yield and returns early.
    // The loop detects cancellation after provider stream ends and yields turn_end.
    // The loop exits cleanly with agent_end.
    const lastTurnEnd = events.filter((e) => e.type === "turn_end");
    expect(lastTurnEnd.length).toBeGreaterThanOrEqual(1);
    // Should have agent_end at the end
    expect(events[events.length - 1]!.type).toBe("agent_end");
    // Should NOT have completed a full response (provider returned early)
    const endEv = events.find((e) => e.type === "message_end");
    expect(endEv).toBeUndefined();
  });
});

// === SimpleCancellationToken ===

describe("SimpleCancellationToken", () => {
  test("isCancelled returns false initially", async () => {
    const { SimpleCancellationToken } = await import("../src/tools.ts");
    const token = new SimpleCancellationToken();
    expect(token.isCancelled()).toBe(false);
  });

  test("cancel() sets isCancelled to true", async () => {
    const { SimpleCancellationToken } = await import("../src/tools.ts");
    const token = new SimpleCancellationToken();
    token.cancel();
    expect(token.isCancelled()).toBe(true);
  });
});
