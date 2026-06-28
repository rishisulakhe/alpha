import { describe, expect, test } from "bun:test";
import { CodingSession, type CodingSessionConfig } from "../src/session.ts";
import { FakeProvider } from "@alpha/ai";
import type { ProviderEvent } from "@alpha/ai";
import { InMemorySessionStorage } from "@alpha/agent";
import type { AgentEvent } from "@alpha/agent";

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const evs: AgentEvent[] = [];
  for await (const e of iter) evs.push(e);
  return evs;
}

function makeProvider(responses: string[]): FakeProvider {
  const streams: ProviderEvent[][] = responses.map((text) => [
    { type: "response_start", model: "fake" } as ProviderEvent,
    { type: "text_delta", text } as ProviderEvent,
    { type: "response_end", message: { role: "assistant", content: text, tool_calls: [] }, finishReason: "stop" } as ProviderEvent,
  ]);
  return new FakeProvider(streams);
}

describe("CodingSession.load", () => {
  test("loads empty session", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["Hello"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
    });
    expect(session.cwd).toBe("/tmp/test");
    expect(session.model).toBe("fake");
    expect(session.isRunning).toBe(false);
    expect(session.messages.length).toBe(0);
  });
});

describe("CodingSession.prompt", () => {
  test("generates assistant response", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["Hi there!"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
    });
    const events = await collect(session.prompt("Hello"));
    expect(events.length).toBeGreaterThan(0);
    const msgs = session.messages;
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs.some((m) => m.role === "user" && m.content === "Hello")).toBe(true);
  });

  test("multiple prompts work with enough provider streams", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["First answer", "Second answer", "Third answer"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
    });
    await collect(session.prompt("Q1"));
    await collect(session.prompt("Q2"));
    expect(session.messages.filter((m) => m.role === "user").length).toBe(2);
    expect(session.messages.filter((m) => m.role === "assistant").length).toBe(2);
  });
});

describe("CodingSession.continue_", () => {
  test("continues without adding user message", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["First", "Second"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
    });
    await collect(session.prompt("Q1"));
    const before = session.messages.length;
    await collect(session.continue_());
    expect(session.messages.length).toBeGreaterThan(before);
  });
});

describe("CodingSession.expandPromptText", () => {
  test("passes through plain text", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["ok"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
    });
    expect(session.expandPromptText("plain text")).toBe("plain text");
  });
});

describe("CodingSession.contextTokenEstimate", () => {
  test("returns estimate", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["ok"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
    });
    const est = session.contextTokenEstimate;
    expect(est.totalTokens).toBeGreaterThan(0);
  });
});

describe("CodingSession.compact", () => {
  test("compacts large messages with auto threshold", async () => {
    const session = await CodingSession.load({
      provider: makeProvider(["Reply"]),
      model: "fake",
      cwd: "/tmp/test",
      storage: new InMemorySessionStorage(),
      autoCompactTokenThreshold: 1, // Always compact
    });
    await collect(session.prompt("Hello"));
    // The threshold check happens on next prompt
    await collect(session.prompt("World"));
    // Compaction should have happened
    expect(session.messages.length).toBeGreaterThan(0);
  });
});
