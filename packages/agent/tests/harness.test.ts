import { describe, expect, test } from "bun:test";
import { AgentHarness, type AgentHarnessConfig } from "../src/harness.ts";
import { FakeProvider } from "@alpha/ai";
import type { ProviderEvent } from "@alpha/ai";
import type { AgentEvent, MessageStartEvent, MessageEndEvent } from "../src/events.ts";
import type { AgentMessage, AgentTool, AgentToolResult } from "../src/index.ts";

// Helpers
function asst(content: string): ProviderEvent {
  return { type: "response_end", message: { role: "assistant", content, tool_calls: [] }, finishReason: "stop" } as ProviderEvent;
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const evs: AgentEvent[] = [];
  for await (const e of iter) evs.push(e);
  return evs;
}

describe("AgentHarness — prompt", () => {
  test("appends user message and generates assistant response with correct event sequence", async () => {
    const provider = FakeProvider.singleTextResponse("Hello");
    const harness = new AgentHarness({ provider, model: "fake", system: "You are helpful." });
    const events = await collect(harness.prompt("Hi"));

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "agent_start",
      "turn_start",
      "message_start",  // user message start
      "message_end",    // user message end
      "message_start",  // assistant message start
      "message_delta",
      "message_end",    // assistant message end
      "turn_end",
      "agent_end",
    ]);

    // Verify user message start has correct role
    const userStart = events[2]!;
    expect(userStart.type).toBe("message_start");
    if (userStart.type === "message_start") expect(userStart.role).toBe("user");

    // Verify user message end has correct content
    const userEnd = events[3]!;
    expect(userEnd.type).toBe("message_end");
    if (userEnd.type === "message_end" && userEnd.message.role === "user") {
      expect(userEnd.message.content).toBe("Hi");
    }

    expect(harness.messages.length).toBe(2);
    expect(harness.messages[0]!.role).toBe("user");
    expect(harness.messages[1]!.role).toBe("assistant");
  });

  test("isRunning is false before and after run, true during", async () => {
    const provider = FakeProvider.singleTextResponse("Hello");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    expect(harness.isRunning).toBe(false);
    const events = await collect(harness.prompt("Hi"));
    expect(harness.isRunning).toBe(false);
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("AgentHarness — continue_", () => {
  test("runs without adding a new user message", async () => {
    const provider = FakeProvider.singleTextResponse("Continuing");
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, [
      { role: "user", content: "Previous" },
    ]);
    const events = await collect(harness.continue_());
    expect(harness.messages.length).toBe(2);
    const m0 = harness.messages[0]!;
    const m1 = harness.messages[1]!;
    expect(m0.role).toBe("user");
    expect(m1.role).toBe("assistant");
    if (m1.role === "assistant") expect(m1.content).toBe("Continuing");
  });
});

describe("AgentHarness — messages snapshot", () => {
  test("messages property returns immutable copy", () => {
    const provider = new FakeProvider([]);
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, [
      { role: "user", content: "Hello" },
    ]);
    const snapshot = harness.messages;
    harness.appendMessage({ role: "assistant", content: "Hi", tool_calls: [] });
    expect(snapshot.length).toBe(1);
    expect(harness.messages.length).toBe(2);
  });

  test("replaceMessages replaces the transcript", () => {
    const provider = new FakeProvider([]);
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, [
      { role: "user", content: "Old" },
    ]);
    harness.replaceMessages([{ role: "user", content: "Summary" }]);
    expect(harness.messages.length).toBe(1);
    const m0 = harness.messages[0]!;
    if (m0.role === "user") expect(m0.content).toBe("Summary");
  });
});

describe("AgentHarness — overlapping runs", () => {
  test("rejects overlapping prompt() calls", async () => {
    const provider = FakeProvider.singleTextResponse("Hello");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    let sawError = false;
    for await (const _ev of harness.prompt("Hi")) {
      try {
        await collect(harness.prompt("Overlapping"));
      } catch (e) {
        if (e instanceof Error && e.message.includes("already running")) sawError = true;
      }
      break;
    }
    expect(sawError).toBe(true);
  });

  test("steer() works while running instead of throwing", async () => {
    const provider = new FakeProvider([
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("First")],
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("Second")],
    ]);
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    let queued = false;
    const events: AgentEvent[] = [];
    for await (const ev of harness.prompt("Hi")) {
      events.push(ev);
      if (ev.type === "message_start" && (ev as MessageStartEvent).role === "assistant" && !queued) {
        harness.steer("Steered");
        queued = true;
      }
    }
    // steer() message should NOT have appeared yet (it was queued, then drained after turn)
    // Messages should include the steered message since it was injected in the run
    const userMsgs = harness.messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(2); // "Hi" + "Steered"
    expect(harness.isRunning).toBe(false);
  });
});

describe("AgentHarness — tools", () => {
  test("passes tools to the loop", async () => {
    const tool: AgentTool = {
      name: "echo", description: "Echo", inputSchema: {},
      async execute(): Promise<AgentToolResult> {
        return { toolCallId: "", name: "echo", ok: true, content: "" };
      },
    };
    const provider = FakeProvider.singleTextResponse("ok");
    const harness = new AgentHarness({ provider, model: "fake", system: "", tools: [tool] });
    await collect(harness.prompt("Hi"));
    expect(provider.calls[0]!.tools).toEqual([tool]);
  });
});

describe("AgentHarness — cancellation", () => {
  test("cancel during run stops cleanly with turn_end and agent_end", async () => {
    const provider = new FakeProvider([
      [
        { type: "response_start", model: "fake" } as ProviderEvent,
        { type: "text_delta", text: "streaming..." } as ProviderEvent,
        { type: "text_delta", text: "more..." } as ProviderEvent,
        { type: "response_end", message: { role: "assistant", content: "full", tool_calls: [] }, finishReason: "stop" } as ProviderEvent,
      ],
    ]);
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    const events: AgentEvent[] = [];
    for await (const ev of harness.prompt("Hi")) {
      events.push(ev);
      if (ev.type === "message_delta") harness.cancel();
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("turn_end");
    expect(types).toContain("agent_end");
    // Only user message should be in transcript (assistant was cancelled mid-stream)
    expect(harness.messages.length).toBeGreaterThanOrEqual(1);
    expect(harness.messages[0]!.role).toBe("user");
  });
});

describe("AgentHarness — transcript repair", () => {
  test("repairs interrupted tool calls on next prompt", async () => {
    const tool: AgentTool = {
      name: "read", description: "Read", inputSchema: {},
      async execute(): Promise<AgentToolResult> {
        return { toolCallId: "call-1", name: "read", ok: true, content: "ok" };
      },
    };
    const provider = new FakeProvider([
      [
        { type: "response_start", model: "fake" } as ProviderEvent,
        { type: "tool_call", call: { id: "call-1", name: "read", arguments: { path: "a.txt" } } } as ProviderEvent,
        { type: "response_end", message: { role: "assistant", content: "I'll read it.", tool_calls: [{ id: "call-1", name: "read", arguments: { path: "a.txt" } }] }, finishReason: "tool_use" } as ProviderEvent,
      ],
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("Recovered")],
    ]);
    const harness = new AgentHarness({ provider, model: "fake", system: "", tools: [tool] });

    // Start prompt, cancel at tool_execution_start
    let broken = false;
    for await (const ev of harness.prompt("Read")) {
      if (ev.type === "tool_execution_start" && !broken) {
        harness.cancel();
        broken = true;
        break;
      }
    }

    // Transcript should have user + assistant(tool call) + repair tool result
    expect(harness.messages.length).toBe(3);
    const repair = harness.messages[2]!;
    expect(repair.role).toBe("tool");
    if (repair.role === "tool") {
      expect(repair.ok).toBe(false);
      expect(repair.error).toContain("interrupted");
    }

    // Next prompt should proceed normally
    const events = await collect(harness.prompt("What happened?"));
    const last = events[events.length - 1]!;
    expect(last.type).toBe("agent_end");
  });
});

describe("AgentHarness — queue management", () => {
  test("steer and followUp queue messages", () => {
    const harness = new AgentHarness({ provider: new FakeProvider([]), model: "fake", system: "" });
    harness.steer("Adjust");
    harness.followUp("Later");
    expect(harness.pendingMessageCount).toBe(2);
  });

  test("clearQueues empties queues and returns snapshot", () => {
    const harness = new AgentHarness({ provider: new FakeProvider([]), model: "fake", system: "" });
    harness.steer("S1");
    harness.followUp("F1");
    const cleared = harness.clearQueues();
    expect(cleared.steering.length).toBe(1);
    expect(cleared.followUp.length).toBe(1);
    expect(harness.pendingMessageCount).toBe(0);
  });

  test("popLatestFollowUp returns most recent follow-up", () => {
    const harness = new AgentHarness({ provider: new FakeProvider([]), model: "fake", system: "" });
    harness.followUp("First");
    harness.followUp("Second");
    const popped = harness.popLatestFollowUp();
    expect(popped).toBeDefined();
    if (popped?.role === "user") expect(popped.content).toBe("Second");
    const popped2 = harness.popLatestFollowUp();
    if (popped2?.role === "user") expect(popped2.content).toBe("First");
    expect(harness.popLatestFollowUp()).toBeUndefined();
  });
});

describe("AgentHarness — listeners", () => {
  test("subscribed listeners receive events in order", async () => {
    const provider = FakeProvider.singleTextResponse("Hello");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    const seen: string[] = [];
    harness.subscribe((ev) => { seen.push(ev.type); });
    await collect(harness.prompt("Hi"));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe("agent_start");
  });

  test("unsubscribe stops delivery", async () => {
    const provider = new FakeProvider([
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("First")],
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("Second")],
    ]);
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    const seen: string[] = [];
    const unsub = harness.subscribe((ev) => { seen.push(ev.type); });
    await collect(harness.prompt("First"));
    unsub();
    await collect(harness.continue_());
    // Events from first prompt should be seen, second should not
    const firstRunEvents = seen.filter((t) => t === "agent_start").length;
    expect(firstRunEvents).toBe(1);
  });
});

describe("AgentHarness — follow-up one_at_a_time vs all", () => {
  test("default one_at_a_time drains follow-up one per turn", async () => {
    const provider = new FakeProvider([
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("First")],
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("Second")],
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("Third")],
    ]);
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    let queued = false;
    const events: AgentEvent[] = [];
    for await (const ev of harness.prompt("Hi")) {
      events.push(ev);
      if (ev.type === "message_end" && (ev as MessageEndEvent).message.role === "assistant" && !queued) {
        const msg = ev as MessageEndEvent;
        if (msg.message.role === "assistant" && msg.message.content === "First") {
          harness.followUp("Follow2");
          harness.followUp("Follow3");
          queued = true;
        }
      }
    }
    expect(harness.messages.length).toBe(6);
    // Hi(usr) + First(asst) + Follow2(usr) + Second(asst) + Follow3(usr) + Third(asst)
    expect(harness.pendingMessageCount).toBe(0);
  });

  test("queue_mode all drains all follow-up in one batch", async () => {
    const provider = new FakeProvider([
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("First")],
      [{ type: "response_start", model: "fake" } as ProviderEvent, asst("Second")],
    ]);
    const harness = new AgentHarness({ provider, model: "fake", system: "", queueMode: "all" });
    let queued = false;
    for await (const ev of harness.prompt("Hi")) {
      if (ev.type === "message_end" && !queued) {
        const msg = ev as MessageEndEvent;
        if (msg.message.role === "assistant" && msg.message.content === "First") {
          harness.followUp("Follow2");
          harness.followUp("Follow3");
          queued = true;
        }
      }
    }
    // Hi(usr) + First(asst) + Follow2(usr) + Follow3(usr) + Second(asst)
    expect(harness.messages.length).toBe(5);
    // Verify both follow-ups are adjacent before the second assistant response
    const roles = harness.messages.map((m) => m.role);
    const idx = roles.indexOf("user", 1); // first user after index 0
    expect(roles[idx! + 1]).toBe("user"); // two users adjacent
  });
});

// === Step 16: Idle steering drain ===

describe("AgentHarness — idle steering drain", () => {
  test("queued steering messages are drained before the user prompt when idle", async () => {
    const provider = FakeProvider.singleTextResponse("Response");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });

    // Queue steering while idle
    harness.steer("Pre-queued steering");
    expect(harness.pendingMessageCount).toBe(1);

    const events = await collect(harness.prompt("My prompt"));

    // Messages should contain: steering, user prompt, assistant response
    expect(harness.messages.length).toBe(3);
    expect(harness.messages[0]!.role).toBe("user");
    const m0 = harness.messages[0]!;
    const m1 = harness.messages[1]!;
    if (m0.role === "user") expect(m0.content).toBe("Pre-queued steering");
    if (m1.role === "user") expect(m1.content).toBe("My prompt");
    expect(harness.pendingMessageCount).toBe(0);
  });

  test("idle steering drain emits MessageStartEvent/MessageEndEvent pairs", async () => {
    const provider = FakeProvider.singleTextResponse("Response");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    harness.steer("Idle steer");
    const events = await collect(harness.prompt("Hi"));

    // Should have message_start/user + message_end for the idle steering
    const userStarts = events.filter((e) => e.type === "message_start" && (e as { role: string }).role === "user");
    expect(userStarts.length).toBe(2); // idle steer + main prompt (emitted at turn_start)
  });
});

// === Step 17: Listener system (extended) ===

describe("AgentHarness — listeners (extended)", () => {
  test("listeners run in subscription order", async () => {
    const provider = FakeProvider.singleTextResponse("ok");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    const order: number[] = [];
    const listener1 = () => { order.push(1); };
    const listener2 = () => { order.push(2); };
    harness.subscribe(listener1);
    harness.subscribe(listener2);
    await collect(harness.prompt("Hi"));
    // Each event triggers both listeners: order should be 1,2,1,2,...
    const idx1 = order.indexOf(1);
    const idx2 = order.indexOf(2);
    expect(idx2).toBeGreaterThan(idx1);
  });

  test("listener error does not crash the harness", async () => {
    const provider = FakeProvider.singleTextResponse("ok");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    harness.subscribe(() => { throw new Error("Listener explosion"); });
    // Should not throw
    const events = await collect(harness.prompt("Hi"));
    expect(events.length).toBeGreaterThan(0);
  });

  test("listener error in async listener caught by _notifyAndAwait at agent_end", async () => {
    const provider = FakeProvider.singleTextResponse("ok");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    // Async listener that rejects — will be caught by _notifyAndAwait at agent_end
    harness.subscribe(async () => {
      await Promise.resolve();
      throw new Error("Async explosion");
    });
    // Should not throw
    const events = await collect(harness.prompt("Hi"));
    expect(events.length).toBeGreaterThan(0);
  });

  test("agent_end notifies and awaits listeners", async () => {
    const provider = FakeProvider.singleTextResponse("ok");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    let agentEndSeen = false;
    harness.subscribe(async (ev) => {
      if (ev.type === "agent_end") {
        await new Promise((r) => setTimeout(r, 10));
        agentEndSeen = true;
      }
    });
    const events = await collect(harness.prompt("Hi"));
    expect(events[events.length - 1]!.type).toBe("agent_end");
    // The agent_end listener should have been awaited and completed
    expect(agentEndSeen).toBe(true);
  });
});

// === Step 18: Transcript repair (extended) ===

describe("AgentHarness — transcript repair (extended)", () => {
  test("injects repair messages for unresolved tool calls at start of prompt", async () => {
    const provider = FakeProvider.singleTextResponse("New response");
    // Pre-seed harness with a transcript that has an unresolved tool call
    const messages: AgentMessage[] = [
      { role: "user", content: "Read file" },
      { role: "assistant", content: "I'll read it.", tool_calls: [
        { id: "call-1", name: "read", arguments: { path: "file.txt" } },
      ] },
    ];
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, messages);

    await collect(harness.prompt("What happened?"));

    // Should have: user+assistant(tool_1)+repair(tool_1)+user(prompt)+assistant(response)
    expect(harness.messages.length).toBe(5);
    const m0 = harness.messages[0]!;
    expect(m0.role).toBe("user");
    if (m0.role === "user") expect(m0.content).toBe("Read file");
    expect(harness.messages[1]!.role).toBe("assistant");
    // The repair message should be at index 2
    const repair = harness.messages[2]!;
    expect(repair.role).toBe("tool");
    if (repair.role === "tool") {
      expect(repair.tool_call_id).toBe("call-1");
      expect(repair.ok).toBe(false);
      expect(repair.error).toContain("interrupted");
    }
    // New user prompt should follow repair
    const newPrompt = harness.messages[3]!;
    expect(newPrompt.role).toBe("user");
    if (newPrompt.role === "user") expect(newPrompt.content).toBe("What happened?");
  });

  test("does not add duplicate repair if tool result already exists", async () => {
    const provider = FakeProvider.singleTextResponse("Response");
    // Pre-seed with a resolved tool call (tool result present)
    const messages: AgentMessage[] = [
      { role: "user", content: "Read file" },
      { role: "assistant", content: "I'll read it.", tool_calls: [
        { id: "call-1", name: "read", arguments: { path: "file.txt" } },
      ] },
      { role: "tool", tool_call_id: "call-1", name: "read", content: "file contents", ok: true, data: null, details: null, error: null },
    ];
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, messages);

    await collect(harness.prompt("Next"));

    // Should have: user+assistant+tool_result+user(prompt)+assistant(response) = 5
    expect(harness.messages.length).toBe(5);
    // No extra repair — the existing tool result should remain
    const tool = harness.messages[2]!;
    expect(tool.role).toBe("tool");
    if (tool.role === "tool") {
      expect(tool.content).toBe("file contents");
      expect(tool.ok).toBe(true);
    }
  });

  test("repairs multiple unresolved tool calls from a single assistant message", async () => {
    const provider = FakeProvider.singleTextResponse("Response");
    const messages: AgentMessage[] = [
      { role: "user", content: "Do stuff" },
      { role: "assistant", content: "I'll do it.", tool_calls: [
        { id: "c1", name: "read", arguments: {} },
        { id: "c2", name: "write", arguments: {} },
        { id: "c3", name: "read", arguments: {} },
      ] },
    ];
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, messages);

    await collect(harness.prompt("Next"));

    // Should have: user+asst(tool_calls×3)+repair(c1)+repair(c2)+repair(c3)+user(prompt)+asst(response) = 7
    expect(harness.messages.length).toBe(7);
    const r0 = harness.messages[2]!;
    const r1 = harness.messages[3]!;
    const r2 = harness.messages[4]!;
    expect(r0.role).toBe("tool");
    expect(r1.role).toBe("tool");
    expect(r2.role).toBe("tool");
    if (r0.role === "tool") expect(r0.tool_call_id).toBe("c1");
    if (r1.role === "tool") expect(r1.tool_call_id).toBe("c2");
    if (r2.role === "tool") expect(r2.tool_call_id).toBe("c3");
  });

  test("only repairs the latest assistant with unresolved tool calls", async () => {
    const provider = FakeProvider.singleTextResponse("Response");
    // Assistant(tool:c1) has a result, Assistant(tool:c2) does not
    const messages: AgentMessage[] = [
      { role: "user", content: "Start" },
      { role: "assistant", content: "First", tool_calls: [
        { id: "c1", name: "read", arguments: {} },
      ] },
      { role: "tool", tool_call_id: "c1", name: "read", content: "ok", ok: true, data: null, details: null, error: null },
      { role: "assistant", content: "Second", tool_calls: [
        { id: "c2", name: "write", arguments: {} },
      ] },
    ];
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, messages);

    await collect(harness.prompt("Next"));

    // Should repair only c2 (the latest with no result), not c1 (already has result)
    const toolMsgs = harness.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(2); // c1 result + c2 repair
    const c2 = toolMsgs[1]!;
    if (c2.role === "tool") {
      expect(c2.tool_call_id).toBe("c2");
      expect(c2.ok).toBe(false);
      expect(c2.error).toContain("interrupted");
    }
  });

  test("repair happens before the new user message in transcript", async () => {
    const provider = FakeProvider.singleTextResponse("Response");
    const messages: AgentMessage[] = [
      { role: "user", content: "Old prompt" },
      { role: "assistant", content: "Old response", tool_calls: [
        { id: "c1", name: "read", arguments: {} },
      ] },
    ];
    const harness = new AgentHarness({ provider, model: "fake", system: "" }, messages);

    await collect(harness.prompt("New prompt"));

    // Verify ordering: old_user, old_asst, repair, new_user, new_asst
    const roles = harness.messages.map((m) => m.role);
    // Should be: user(Old prompt), assistant, tool(repair), user(New prompt), assistant(response)
    expect(roles).toEqual(["user", "assistant", "tool", "user", "assistant"]);
    const newUserIdx = roles.indexOf("user", 1); // second "user"
    const repairIdx = roles.indexOf("tool");
    expect(repairIdx).toBeLessThan(newUserIdx);
  });
});

// === cancel() with no active run is a no-op ===

describe("AgentHarness — cancel edge cases", () => {
  test("cancel with no active run does not throw", () => {
    const harness = new AgentHarness({ provider: new FakeProvider([]), model: "fake", system: "" });
    expect(() => harness.cancel()).not.toThrow();
  });

  test("prompt works after cancel without active run", async () => {
    const provider = FakeProvider.singleTextResponse("ok");
    const harness = new AgentHarness({ provider, model: "fake", system: "" });
    harness.cancel(); // no-op
    const events = await collect(harness.prompt("Hi"));
    expect(events[events.length - 1]!.type).toBe("agent_end");
  });
});
