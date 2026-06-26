import { describe, expect, test } from "bun:test";
import { OpenAICompatibleProvider, convertToOpenAIMessage, convertTools } from "../src/providers/openai-compatible.ts";
import type { AgentMessage, AgentTool } from "@alpha/agent";
import type { ProviderEvent } from "../src/events.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createServer(handler: (req: Request) => Response | Promise<Response>): ReturnType<typeof Bun.serve> {
  return Bun.serve({ port: 0, fetch: handler });
}

const textTool: AgentTool = {
  name: "echo",
  description: "Echo text",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute() {
    return { toolCallId: "", name: "echo", ok: true, content: "" };
  },
};

// ---------------------------------------------------------------------------
// ToolCallBuilder tests (via provider + mock server)
// ---------------------------------------------------------------------------

describe("ToolCallBuilder accumulation", () => {
  test("accumulates single delta with all fields", async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"path\\":\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/tmp/file.txt\\"}"}}]}}]}',
      "data: [DONE]",
    ];

    const server = createServer((_req) => {
      const body = sseChunks.join("\n\n") + "\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new OpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "gpt-4",
      system: "You are helpful.",
      messages: [{ role: "user", content: "read /tmp/file.txt" }],
      tools: [textTool],
    })) {
      events.push(ev);
    }

    server.stop(true);

    const toolCallEvents = events.filter((e) => e.type === "tool_call");
    expect(toolCallEvents.length).toBe(1);
    const firstTc = toolCallEvents[0]!;
    if (firstTc.type === "tool_call") {
      expect(firstTc.call.id).toBe("call-1");
      expect(firstTc.call.name).toBe("read");
      expect(firstTc.call.arguments).toEqual({ path: "/tmp/file.txt" });
    }
  });

  test("handles multiple tool calls across indices", async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":"{}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"write","arguments":"{\\"path\\":\\"/tmp/out.txt\\"}"}}]}}]}',
      "data: [DONE]",
    ];

    const server = createServer((_req) => {
      const body = sseChunks.join("\n\n") + "\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new OpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "gpt-4",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      tools: [textTool],
    })) {
      events.push(ev);
    }

    server.stop(true);

    const toolCallEvents2 = events.filter((e) => e.type === "tool_call");
    expect(toolCallEvents2.length).toBe(2);
    const tc0 = toolCallEvents2[0]!;
    const tc1 = toolCallEvents2[1]!;
    if (tc0.type === "tool_call") expect(tc0.call.name).toBe("read");
    if (tc1.type === "tool_call") expect(tc1.call.name).toBe("write");
  });
});

// ---------------------------------------------------------------------------
// Message conversion
// ---------------------------------------------------------------------------

describe("convertToOpenAIMessage", () => {
  test("converts user message", () => {
    const msg: AgentMessage = { role: "user", content: "hello" };
    const result = convertToOpenAIMessage(msg);
    expect(result).toEqual({ role: "user", content: "hello" });
  });

  test("converts assistant message with tool calls", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: "Let me read that.",
      tool_calls: [{ id: "c1", name: "read", arguments: { path: "file.txt" } }],
    };
    const result = convertToOpenAIMessage(msg);
    expect(result.role).toBe("assistant");
    const toolCalls = result.tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toBeDefined();
    expect(toolCalls![0]!.function).toBeDefined();
  });

  test("converts assistant message without tool calls", () => {
    const msg: AgentMessage = { role: "assistant", content: "Done.", tool_calls: [] };
    const result = convertToOpenAIMessage(msg);
    expect(result.role).toBe("assistant");
    expect(result.tool_calls).toBeUndefined();
  });

  test("converts tool result message", () => {
    const msg: AgentMessage = {
      role: "tool",
      tool_call_id: "c1",
      name: "read",
      content: "file contents",
      ok: true,
      data: null,
      details: null,
      error: null,
    };
    const result = convertToOpenAIMessage(msg);
    expect(result).toEqual({
      role: "tool",
      tool_call_id: "c1",
      name: "read",
      content: "file contents",
    });
  });
});

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

describe("convertTools", () => {
  test("converts AgentTool to OpenAI function definition", () => {
    const result = convertTools([textTool]);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe("function");
    const fn = (result[0] as { function: Record<string, unknown> }).function;
    expect(fn.name).toBe("echo");
    expect(fn.parameters).toEqual(textTool.inputSchema);
  });
});

// ---------------------------------------------------------------------------
// SSE integration — full text response
// ---------------------------------------------------------------------------

describe("OpenAICompatibleProvider — text streaming", () => {
  test("streams text deltas and ends with response_end", async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" World"}}]}',
      'data: {"choices":[{"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];

    const server = createServer((_req) => {
      const body = sseLines.join("\n\n") + "\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new OpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "gpt-4",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    })) {
      events.push(ev);
    }

    server.stop(true);

    expect(events.length).toBeGreaterThanOrEqual(3);

    const start = events.find((e) => e.type === "response_start");
    expect(start).toBeDefined();

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBe(2);
    const td0 = textDeltas[0]!;
    if (td0.type === "text_delta") expect(td0.text).toBe("Hello");

    const end = events.find((e) => e.type === "response_end")!;
    expect(end).toBeDefined();
    if (end.type === "response_end") {
      expect(end.message.content).toBe("Hello World");
      expect(end.finishReason).toBe("stop");
    }
  });

  test("handles HTTP error as ProviderErrorEvent", async () => {
    const server = createServer((_req) => new Response("Unauthorized", { status: 401 }));

    const provider = new OpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "gpt-4",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    })) {
      events.push(ev);
    }

    server.stop(true);

    expect(events.length).toBe(1);
    const err = events[0]!;
    expect(err.type).toBe("error");
    if (err.type === "error") {
      expect(err.statusCode).toBe(401);
      expect(err.recoverable).toBe(false);
    }
  });

  test("handles thinking deltas via reasoning_content field", async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"reasoning_content":"Let me think about this..."}}]}',
      'data: {"choices":[{"delta":{"content":"Answer."}}]}',
      'data: {"choices":[{"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];

    const server = createServer((_req) => {
      const body = sseLines.join("\n\n") + "\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new OpenAICompatibleProvider({
      apiKey: "sk-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "gpt-4",
      system: "",
      messages: [{ role: "user", content: "question" }],
      tools: [],
    })) {
      events.push(ev);
    }

    server.stop(true);

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(1);
    const td0 = thinkingDeltas[0]!;
    if (td0.type === "thinking_delta") {
      expect(td0.text).toBe("Let me think about this...");
    }
  });
});
