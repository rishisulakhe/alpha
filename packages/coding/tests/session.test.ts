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

function baseConfig(overrides?: Partial<CodingSessionConfig>): CodingSessionConfig {
  return { provider: makeProvider(["Hello"]), model: "fake", cwd: "/tmp/test",
    storage: new InMemorySessionStorage(), ...overrides };
}

// === load ===

describe("CodingSession.load", () => {
  test("loads empty session", async () => {
    const s = await CodingSession.load(baseConfig());
    expect(s.cwd).toBe("/tmp/test");
    expect(s.isRunning).toBe(false);
    expect(s.messages.length).toBe(0);
  });
});

// === prompt ===

describe("CodingSession.prompt", () => {
  test("generates assistant response", async () => {
    const s = await CodingSession.load(baseConfig({ provider: makeProvider(["Hi!"]) }));
    await collect(s.prompt("Hello"));
    expect(s.messages.some((m) => m.role === "user" && m.content === "Hello")).toBe(true);
  });

  test("multiple prompts", async () => {
    const s = await CodingSession.load(baseConfig({ provider: makeProvider(["A1", "A2", "A3"]) }));
    await collect(s.prompt("Q1"));
    await collect(s.prompt("Q2"));
    expect(s.messages.filter((m) => m.role === "user").length).toBe(2);
  });
});

// === continue_ ===

describe("CodingSession.continue_", () => {
  test("continues without adding user message", async () => {
    const s = await CodingSession.load(baseConfig({ provider: makeProvider(["First", "Second"]) }));
    await collect(s.prompt("Q1"));
    const before = s.messages.length;
    await collect(s.continue_());
    expect(s.messages.length).toBeGreaterThan(before);
  });
});

// === persistence ===

describe("CodingSession — persistence", () => {
  test("persists messages as entries in storage", async () => {
    const storage = new InMemorySessionStorage();
    const s = await CodingSession.load(baseConfig({ storage, provider: makeProvider(["A"]) }));
    await collect(s.prompt("Hello"));
    const entries = await storage.readAll();
    const msgs = entries.filter((e) => e.type === "message");
    expect(msgs.length).toBeGreaterThanOrEqual(2); // user + assistant
  });

  test("leaf entries track the active branch", async () => {
    const storage = new InMemorySessionStorage();
    const s = await CodingSession.load(baseConfig({ storage, provider: makeProvider(["A"]) }));
    await collect(s.prompt("Q1"));
    const entries = await storage.readAll();
    const leaves = entries.filter((e) => e.type === "leaf");
    expect(leaves.length).toBeGreaterThanOrEqual(1);
  });

  test("load restores messages from storage", async () => {
    const storage = new InMemorySessionStorage();
    const s1 = await CodingSession.load(baseConfig({ storage, provider: makeProvider(["A1", "A2"]) }));
    await collect(s1.prompt("Q1"));
    await collect(s1.prompt("Q2"));

    const s2 = await CodingSession.load(baseConfig({ storage, provider: makeProvider(["X"]) }));
    expect(s2.messages.length).toBeGreaterThanOrEqual(4); // Q1+asst + Q2+asst
  });
});

// === branching ===

describe("CodingSession — branching", () => {
  test("treeChoices returns message entries", async () => {
    const s = await CodingSession.load(baseConfig({ storage: new InMemorySessionStorage(), provider: makeProvider(["A"]) }));
    await collect(s.prompt("Hello"));
    const choices = s.treeChoices();
    expect(choices.length).toBeGreaterThanOrEqual(1);
    expect(choices[0]!.entryId).toBeTypeOf("string");
  });

  test("branchTo creates leaf and reloads state", async () => {
    const storage = new InMemorySessionStorage();
    const s = await CodingSession.load(baseConfig({ storage, provider: makeProvider(["A", "B"]) }));
    await collect(s.prompt("Q1"));
    await collect(s.prompt("Q2"));
    const msgsBefore = s.messages.length;

    const choices = s.treeChoices();
    const firstUserEntry = choices[0]!;

    await s.branchTo(firstUserEntry.entryId);
    // After branching, messages should reflect the new path
    expect(s.messages.length).toBeGreaterThan(0);
  });
});

// === expandPromptText ===

describe("CodingSession.expandPromptText", () => {
  test("passes through plain text", async () => {
    const s = await CodingSession.load(baseConfig());
    expect(s.expandPromptText("plain")).toBe("plain");
  });
});

// === context tokens ===

describe("CodingSession.contextTokenEstimate", () => {
  test("returns estimate", async () => {
    const s = await CodingSession.load(baseConfig());
    expect(s.contextTokenEstimate.totalTokens).toBeGreaterThan(0);
  });
});
