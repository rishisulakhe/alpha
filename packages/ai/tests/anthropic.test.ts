import { describe, expect, test } from "bun:test";
import { AnthropicProvider, convertToAnthropicMessage, convertToAnthropicTools } from "../src/providers/anthropic.ts";
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
// Message conversion
// ---------------------------------------------------------------------------

describe("convertToAnthropicMessage", () => {
  test("converts user message", () => {
    const msg: AgentMessage = { role: "user", content: "hello" };
    const result = convertToAnthropicMessage(msg);
    expect(result).toEqual({ role: "user", content: "hello" });
  });

  test("converts assistant message with text and tool calls", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: "Let me read that.",
      tool_calls: [{ id: "c1", name: "read", arguments: { path: "file.txt" } }],
    };
    const result = convertToAnthropicMessage(msg);
    expect(result.role).toBe("assistant");
    const content = result.content as Array<Record<string, unknown>>;
    expect(content.length).toBe(2);
    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toBe("Let me read that.");
    expect(content[1]!.type).toBe("tool_use");
    expect(content[1]!.name).toBe("read");
    expect(content[1]!.input).toEqual({ path: "file.txt" });
  });

  test("converts assistant message without content", () => {
    const msg: AgentMessage = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", name: "read", arguments: {} }],
    };
    const result = convertToAnthropicMessage(msg);
    const content = result.content as Array<Record<string, unknown>>;
    expect(content.length).toBe(1);
    expect(content[0]!.type).toBe("tool_use");
  });

  test("converts tool result as user message", () => {
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
    const result = convertToAnthropicMessage(msg);
    expect(result.role).toBe("user");
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0]!.type).toBe("tool_result");
    expect(content[0]!.tool_use_id).toBe("c1");
    expect(content[0]!.content).toBe("file contents");
    expect(content[0]!.is_error).toBe(false);
  });

  test("converts failed tool result with is_error flag", () => {
    const msg: AgentMessage = {
      role: "tool",
      tool_call_id: "c2",
      name: "read",
      content: "",
      ok: false,
      error: "File not found",
      data: null,
      details: null,
    };
    const result = convertToAnthropicMessage(msg);
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0]!.is_error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

describe("convertToAnthropicTools", () => {
  test("converts AgentTool to Anthropic format", () => {
    const result = convertToAnthropicTools([textTool]);
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe("echo");
    expect(result[0]!.description).toBe("Echo text");
    expect(result[0]!.input_schema).toEqual(textTool.inputSchema);
  });
});

// ---------------------------------------------------------------------------
// SSE integration — text streaming
// ---------------------------------------------------------------------------

describe("AnthropicProvider — text streaming", () => {
  test("streams text deltas via content_block_delta events", async () => {
    const sseLines = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
    ];

    // Use standard data:-only format (no SSE event: lines needed)
    const simpleLines = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" World"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      'data: {"type":"message_stop"}',
    ];

    const server = createServer((_req) => {
      const body = simpleLines.join("\n\n") + "\n\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "claude-sonnet-4-6",
      system: "You are helpful.",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    })) {
      events.push(ev);
    }

    server.stop(true);

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBe(2);
    const td0 = textDeltas[0]!;
    const td1 = textDeltas[1]!;
    if (td0.type === "text_delta") expect(td0.text).toBe("Hello");
    if (td1.type === "text_delta") expect(td1.text).toBe(" World");

    const end = events.find((e) => e.type === "response_end")!;
    expect(end).toBeDefined();
    if (end.type === "response_end") {
      expect(end.message.content).toBe("Hello World");
      expect(end.finishReason).toBe("end_turn");
    }
  });

  test("handles tool use via content_block_start + input_json_delta", async () => {
    const sseLines = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01","name":"read"}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"/tmp/file.txt\\"}"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      'data: {"type":"message_stop"}',
    ];

    const server = createServer((_req) => {
      const body = sseLines.join("\n\n") + "\n\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "claude-sonnet-4-6",
      system: "",
      messages: [{ role: "user", content: "read file" }],
      tools: [textTool],
    })) {
      events.push(ev);
    }

    server.stop(true);

    const toolCallEvents = events.filter((e) => e.type === "tool_call");
    expect(toolCallEvents.length).toBe(1);
    const tc0 = toolCallEvents[0]!;
    if (tc0.type === "tool_call") {
      expect(tc0.call.id).toBe("toolu_01");
      expect(tc0.call.name).toBe("read");
      expect(tc0.call.arguments).toEqual({ path: "/tmp/file.txt" });
    }
  });

  test("handles thinking deltas", async () => {
    const sseLines = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm, let me reason..."}}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Answer"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      'data: {"type":"message_stop"}',
    ];

    const server = createServer((_req) => {
      const body = sseLines.join("\n\n") + "\n\n";
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "claude-sonnet-4-6",
      system: "",
      messages: [{ role: "user", content: "complex question" }],
      tools: [],
    })) {
      events.push(ev);
    }

    server.stop(true);

    const thinkingDeltas = events.filter((e) => e.type === "thinking_delta");
    expect(thinkingDeltas.length).toBe(1);
    const td0 = thinkingDeltas[0]!;
    if (td0.type === "thinking_delta") {
      expect(td0.text).toBe("Hmm, let me reason...");
    }
  });

  test("handles HTTP error", async () => {
    const server = createServer((_req) => new Response("Forbidden", { status: 403 }));

    const provider = new AnthropicProvider({
      apiKey: "sk-ant-test",
      baseUrl: `http://localhost:${server.port}`,
      maxRetries: 0,
    });

    const events: ProviderEvent[] = [];
    for await (const ev of provider.streamResponse({
      model: "claude-sonnet-4-6",
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
      expect(err.statusCode).toBe(403);
      expect(err.recoverable).toBe(false);
    }
  });
});
