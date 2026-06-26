import { describe, expect, test } from "bun:test";
import type { AgentTool, AgentToolResult, CancellationToken, JSONObject } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class SimpleCancellationToken implements CancellationToken {
  private _cancelled = false;
  isCancelled(): boolean {
    return this._cancelled;
  }
  cancel(): void {
    this._cancelled = true;
  }
}

function createEchoTool(): AgentTool {
  return {
    name: "echo",
    description: "Echoes the provided text back.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to echo." },
      },
      required: ["text"],
    },
    async execute(args: JSONObject, signal?: CancellationToken): Promise<AgentToolResult> {
      return {
        toolCallId: "call-1",
        name: "echo",
        ok: true,
        content: String(args.text ?? ""),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CancellationToken", () => {
  test("SimpleCancellationToken reports not cancelled initially", () => {
    const token = new SimpleCancellationToken();
    expect(token.isCancelled()).toBe(false);
  });

  test("SimpleCancellationToken reports cancelled after cancel()", () => {
    const token = new SimpleCancellationToken();
    token.cancel();
    expect(token.isCancelled()).toBe(true);
  });
});

describe("AgentTool.execute()", () => {
  test("receives arguments and returns result", async () => {
    const tool = createEchoTool();
    const result = await tool.execute({ text: "hello world" });

    expect(result.ok).toBe(true);
    expect(result.content).toBe("hello world");
    expect(result.name).toBe("echo");
    expect(result.toolCallId).toBe("call-1");
  });

  test("receives cancellation signal", async () => {
    const signal = new SimpleCancellationToken();
    let observedSignal: CancellationToken | undefined;

    const tool: AgentTool = {
      name: "observer",
      description: "Records the signal.",
      inputSchema: {},
      async execute(_args, s) {
        observedSignal = s;
        return { toolCallId: "call-2", name: "observer", ok: true, content: "" };
      },
    };

    await tool.execute({}, signal);

    expect(observedSignal).toBe(signal);
    expect((observedSignal as SimpleCancellationToken).isCancelled()).toBe(false);
  });

  test("can observe cancellation mid-execution", async () => {
    const signal = new SimpleCancellationToken();

    const tool: AgentTool = {
      name: "cancellable",
      description: "Checks cancellation.",
      inputSchema: {},
      async execute(_args, s) {
        if (s?.isCancelled()) {
          return { toolCallId: "call-3", name: "cancellable", ok: false, content: "", error: "cancelled" };
        }
        return { toolCallId: "call-3", name: "cancellable", ok: true, content: "ran" };
      },
    };

    const result1 = await tool.execute({}, signal);
    expect(result1.ok).toBe(true);
    expect(result1.content).toBe("ran");

    signal.cancel();
    const result2 = await tool.execute({}, signal);
    expect(result2.ok).toBe(false);
    expect(result2.error).toBe("cancelled");
  });

  test("returns structured error result for failures", async () => {
    const tool: AgentTool = {
      name: "failing",
      description: "Always fails.",
      inputSchema: {},
      async execute() {
        return {
          toolCallId: "call-err",
          name: "failing",
          ok: false,
          content: "",
          error: "Something went wrong",
          data: { attempt: 1 },
        };
      },
    };

    const result = await tool.execute({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Something went wrong");
    expect(result.data).toEqual({ attempt: 1 });
  });
});

describe("AgentTool metadata", () => {
  test("carries prompt snippet for system prompt", () => {
    const tool = createEchoTool();
    tool.promptSnippet = "echo(text: string) — Echoes the provided text.";
    expect(tool.promptSnippet).toBe("echo(text: string) — Echoes the provided text.");
  });

  test("carries prompt guidelines for system prompt", () => {
    const tool = createEchoTool();
    tool.promptGuidelines = "Use echo sparingly.";
    expect(tool.promptGuidelines).toBe("Use echo sparingly.");
  });

  test("inputSchema is a JSON Schema object", () => {
    const tool = createEchoTool();
    expect(tool.inputSchema).toHaveProperty("type", "object");
    expect(tool.inputSchema).toHaveProperty("properties");
  });
});

describe("AgentToolResult shape", () => {
  test("has the expected fields", () => {
    const result: AgentToolResult = {
      toolCallId: "id",
      name: "tool",
      ok: true,
      content: "output",
    };
    expect(result.toolCallId).toBe("id");
    expect(result.name).toBe("tool");
    expect(result.ok).toBe(true);
    expect(result.content).toBe("output");
    expect(result.data).toBeUndefined();
    expect(result.details).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("can carry structured data and details", () => {
    const result: AgentToolResult = {
      toolCallId: "id",
      name: "read",
      ok: true,
      content: "file contents",
      data: { path: "/tmp/file.txt", bytes: 42 },
      details: { truncated: false, lines: 10 },
    };
    expect(result.data?.path).toBe("/tmp/file.txt");
    expect(result.details?.lines).toBe(10);
  });
});
