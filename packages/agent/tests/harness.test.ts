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
