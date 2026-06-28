import { describe, expect, test } from "bun:test";
import { FinalTextRenderer, JsonEventRenderer, TranscriptRenderer, createEventRenderer } from "../src/rendering/index.ts";
import type { AgentEvent } from "@alpha/agent";

// Helpers
function captureStdout(fn: () => boolean): string {
  let out = "";
  const orig = process.stdout.write;
  process.stdout.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
  try { return fn() ? out : out; } finally { process.stdout.write = orig; }
}

function captureStderr(fn: () => boolean): string {
  let out = "";
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
  try { return fn() ? out : out; } finally { process.stderr.write = orig; }
}

describe("FinalTextRenderer", () => {
  test("outputs only the last assistant message on finish", () => {
    let out = "";
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
    try {
      const r = new FinalTextRenderer();
      r.render({ type: "message_delta", text: "Hello" } satisfies AgentEvent);
      r.render({ type: "message_delta", text: " World" } satisfies AgentEvent);
      r.render({ type: "message_end", message: { role: "assistant", content: "Hello World", tool_calls: [] } } satisfies AgentEvent);
      r.finish();
      expect(out.trim()).toBe("Hello World");
    } finally {
      process.stdout.write = orig;
    }
  });

  test("returns false if nothing was rendered", () => {
    const r = new FinalTextRenderer();
    expect(r.finish()).toBe(false);
  });
});

describe("JsonEventRenderer", () => {
  test("outputs each event as JSONL", () => {
    let out = "";
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
    try {
      const r = new JsonEventRenderer();
      r.render({ type: "message_start", role: "assistant" } satisfies AgentEvent);
      r.render({ type: "message_delta", text: "Hi" } satisfies AgentEvent);
      r.finish();
      const lines = out.trim().split("\n");
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]!).type).toBe("message_start");
      expect(JSON.parse(lines[1]!).type).toBe("message_delta");
    } finally {
      process.stdout.write = orig;
    }
  });

  test("finish returns true if events were rendered", () => {
    const r = new JsonEventRenderer();
    r.render({ type: "agent_start" } satisfies AgentEvent);
    expect(r.finish()).toBe(true);
  });
});

describe("TranscriptRenderer", () => {
  test("streams text deltas in real-time with role markers", () => {
    let out = "";
    const orig = process.stdout.write;
    process.stdout.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
    try {
      const r = new TranscriptRenderer();
      r.render({ type: "message_start", role: "assistant" } satisfies AgentEvent);
      r.render({ type: "message_delta", text: "Hello" } satisfies AgentEvent);
      r.render({ type: "message_delta", text: " World" } satisfies AgentEvent);
      r.finish();
      expect(out).toContain("[Assistant]");
      expect(out).toContain("Hello World");
    } finally {
      process.stdout.write = orig;
    }
  });

  test("writes tool output and thinking to stderr", () => {
    let out = "";
    const orig = process.stderr.write;
    process.stderr.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
    try {
      const r = new TranscriptRenderer();
      r.render({ type: "tool_execution_start", call: { id: "c1", name: "read", arguments: {} } } satisfies AgentEvent);
      r.render({ type: "tool_execution_end", result: { toolCallId: "c1", name: "read", ok: true, content: "file content here" } } satisfies AgentEvent);
      r.render({ type: "thinking_delta", text: "Let me think..." } satisfies AgentEvent);
      r.finish();
      expect(out).toContain("[tool] Running: read");
      expect(out).toContain("[tool] OK: read");
      expect(out).toContain("[thinking] Let me think...");
    } finally {
      process.stderr.write = orig;
    }
  });

  test("writes retry and error to stderr", () => {
    let out = "";
    const orig = process.stderr.write;
    process.stderr.write = (chunk) => { out += typeof chunk === "string" ? chunk : ""; return true; };
    try {
      const r = new TranscriptRenderer();
      r.render({ type: "retry", attempt: 1, maxAttempts: 3, delaySeconds: 0.5, message: "retrying" } satisfies AgentEvent);
      r.render({ type: "error", message: "something failed", recoverable: false } satisfies AgentEvent);
      r.finish();
      expect(out).toContain("[retry] retrying");
      expect(out).toContain("[error] something failed");
    } finally {
      process.stderr.write = orig;
    }
  });
});

describe("createEventRenderer", () => {
  test("returns FinalTextRenderer for 'text'", () => {
    expect(createEventRenderer("text")).toBeInstanceOf(FinalTextRenderer);
  });

  test("returns JsonEventRenderer for 'json'", () => {
    expect(createEventRenderer("json")).toBeInstanceOf(JsonEventRenderer);
  });

  test("returns TranscriptRenderer for 'transcript'", () => {
    expect(createEventRenderer("transcript")).toBeInstanceOf(TranscriptRenderer);
  });

  test("defaults to FinalTextRenderer for unknown format", () => {
    expect(createEventRenderer("unknown")).toBeInstanceOf(FinalTextRenderer);
  });
});
