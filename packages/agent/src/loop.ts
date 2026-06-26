import type { ModelProvider, ProviderEvent } from "@alpha/ai";
import type { AgentMessage, AssistantMessage, ToolCall, ToolResultMessage } from "./messages.ts";
import type { AgentTool, AgentToolResult, CancellationToken } from "./tools.ts";
import {
  type AgentEvent,
  type AgentStartEvent,
  type AgentEndEvent,
  type TurnStartEvent,
  type TurnEndEvent,
  type MessageStartEvent,
  type MessageDeltaEvent,
  type ThinkingDeltaEvent,
  type MessageEndEvent,
  type ToolExecutionStartEvent,
  type ToolExecutionEndEvent,
  type RetryEvent,
  type QueueUpdateEvent,
  type ErrorEvent,
} from "./events.ts";

// ---------------------------------------------------------------------------
// runAgentLoop
// ---------------------------------------------------------------------------

export async function* runAgentLoop(opts: {
  provider: ModelProvider;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  maxTurns?: number;
  signal?: CancellationToken;
  getSteeringMessages?: () => AgentMessage[];
  getFollowUpMessages?: () => AgentMessage[];
  getQueueUpdate?: () => Omit<QueueUpdateEvent, "type">;
  queueMode?: "one_at_a_time" | "all";
}): AsyncIterable<AgentEvent> {
  const queueMode = opts.queueMode ?? "one_at_a_time";

  yield { type: "agent_start" } satisfies AgentStartEvent;

  if (opts.maxTurns != null && opts.maxTurns < 1) {
    yield { type: "error", message: "max_turns must be at least 1", recoverable: false } satisfies ErrorEvent;
    yield { type: "agent_end" } satisfies AgentEndEvent;
    return;
  }

  const toolByName = new Map(opts.tools.map((t) => [t.name, t]));
  let turn = 1;

  while (opts.maxTurns == null || turn <= opts.maxTurns) {
    if (opts.signal?.isCancelled()) {
      yield { type: "error", message: "Agent run cancelled", recoverable: true } satisfies ErrorEvent;
      break;
    }

    yield { type: "turn_start", turn } satisfies TurnStartEvent;

    // Drain steering at the top of the turn (before provider call)
    for (const ev of _drainQueuedMessages(opts.messages, opts.getSteeringMessages, opts.getQueueUpdate, queueMode)) {
      yield ev;
    }

    let assistantMessage: AssistantMessage | null = null;
    let sawProviderError = false;

    for await (const pe of opts.provider.streamResponse({
      model: opts.model,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      signal: opts.signal,
    })) {
      if (opts.signal?.isCancelled()) {
        yield { type: "error", message: "Agent run cancelled", recoverable: true } satisfies ErrorEvent;
        break;
      }

      switch (pe.type) {
        case "response_start":
          yield { type: "message_start", role: "assistant" as const } satisfies MessageStartEvent;
          break;
        case "text_delta":
          yield { type: "message_delta", text: pe.text } satisfies MessageDeltaEvent;
          break;
        case "thinking_delta":
          yield { type: "thinking_delta", text: pe.text } satisfies ThinkingDeltaEvent;
          break;
        case "retry":
          yield {
            type: "retry",
            attempt: pe.attempt,
            maxAttempts: pe.maxAttempts,
            delaySeconds: pe.delaySeconds,
            message: pe.message,
          } satisfies RetryEvent;
          break;
        case "tool_call":
          break;
        case "response_end":
          assistantMessage = pe.message;
          opts.messages.push(assistantMessage);
          yield { type: "message_end", message: assistantMessage } satisfies MessageEndEvent;
          break;
        case "error":
          sawProviderError = true;
          yield {
            type: "error",
            message: pe.message,
            recoverable: false,
            statusCode: pe.statusCode,
          } satisfies ErrorEvent;
          break;
      }
    }

    // If cancelled during provider stream, exit cleanly
    if (opts.signal?.isCancelled()) {
      yield { type: "turn_end", turn } satisfies TurnEndEvent;
      break;
    }

    if (assistantMessage === null) {
      yield { type: "turn_end", turn } satisfies TurnEndEvent;
      if (sawProviderError) break;
      yield { type: "error", message: "Provider stream ended without an assistant message", recoverable: false } satisfies ErrorEvent;
      break;
    }

    if (assistantMessage.tool_calls.length === 0) {
      yield { type: "turn_end", turn } satisfies TurnEndEvent;

      let hadSteering = false;
      for (const ev of _drainQueuedMessages(opts.messages, opts.getSteeringMessages, opts.getQueueUpdate, queueMode)) {
        yield ev;
        hadSteering = true;
      }
      if (hadSteering) { turn++; continue; }

      let hadFollowUp = false;
      for (const ev of _drainQueuedMessages(opts.messages, opts.getFollowUpMessages, opts.getQueueUpdate, "all")) {
        yield ev;
        hadFollowUp = true;
      }
      if (hadFollowUp) { turn++; continue; }

      break;
    }

    // Execute tool calls
    async function* executeToolCallsInner(): AsyncIterable<AgentEvent> {
      for (let i = 0; i < assistantMessage!.tool_calls.length; i++) {
        const tc = assistantMessage!.tool_calls[i]!;

        if (opts.signal?.isCancelled()) {
          for (let j = i; j < assistantMessage!.tool_calls.length; j++) {
            const cancelledCall = assistantMessage!.tool_calls[j]!;
            const result = _cancelledToolResult(cancelledCall);
            opts.messages.push(_toolResultMessage(result));
            yield { type: "tool_execution_end", result } satisfies ToolExecutionEndEvent;
          }
          yield { type: "error", message: "Agent run cancelled", recoverable: true } satisfies ErrorEvent;
          return;
        }

        yield { type: "tool_execution_start", call: tc } satisfies ToolExecutionStartEvent;

        const tool = toolByName.get(tc.name);
        let result: AgentToolResult;
        if (!tool) {
          result = _unknownToolResult(tc);
        } else {
          try {
            const execResult = await tool.execute(tc.arguments, opts.signal);
            result = execResult.toolCallId !== tc.id
              ? { ...execResult, toolCallId: tc.id }
              : execResult;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result = { toolCallId: tc.id, name: tc.name, ok: false, content: msg, error: msg };
          }
        }

        opts.messages.push(_toolResultMessage(result));
        yield { type: "tool_execution_end", result } satisfies ToolExecutionEndEvent;
      }
    }

    for await (const ev of executeToolCallsInner()) {
      yield ev;
    }

    yield { type: "turn_end", turn } satisfies TurnEndEvent;

    for (const ev of _drainQueuedMessages(opts.messages, opts.getSteeringMessages, opts.getQueueUpdate, queueMode)) {
      yield ev;
    }

    turn++;
  }

  if (opts.maxTurns != null && turn > opts.maxTurns) {
    yield {
      type: "error",
      message: `Agent loop stopped after reaching max_turns=${opts.maxTurns}`,
      recoverable: true,
    } satisfies ErrorEvent;
  }

  yield { type: "agent_end" } satisfies AgentEndEvent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function* _drainQueuedMessages(
  messages: AgentMessage[],
  getMessages: (() => AgentMessage[]) | undefined,
  getQueueUpdate: (() => Omit<QueueUpdateEvent, "type">) | undefined,
  mode: "one_at_a_time" | "all" = "all",
): Generator<AgentEvent> {
  if (!getMessages) return;
  const queued = getMessages();
  if (queued.length === 0) return;

  const drained = mode === "one_at_a_time" ? queued.slice(0, 1) : queued;

  for (const msg of drained) {
    messages.push(msg);
    yield { type: "message_start", role: msg.role } satisfies MessageStartEvent;
    yield { type: "message_end", message: msg } satisfies MessageEndEvent;
  }

  if (getQueueUpdate) {
    const update = getQueueUpdate();
    yield { type: "queue_update", steering: update.steering, followUp: update.followUp } satisfies QueueUpdateEvent;
  }
}

function _unknownToolResult(tc: ToolCall): AgentToolResult {
  const msg = `Unknown tool: ${tc.name}`;
  return { toolCallId: tc.id, name: tc.name, ok: false, content: msg, error: msg };
}

function _cancelledToolResult(tc: ToolCall): AgentToolResult {
  const msg = "Tool call cancelled";
  return { toolCallId: tc.id, name: tc.name, ok: false, content: msg, error: msg };
}

function _toolResultMessage(result: AgentToolResult): ToolResultMessage {
  let content = result.content;
  if (!result.ok && result.error && !content.includes(result.error)) {
    content = `${content}\n\nError: ${result.error}`;
  }
  if (result.data != null && !content) {
    content = JSON.stringify(result.data);
  }
  return {
    role: "tool",
    tool_call_id: result.toolCallId,
    name: result.name,
    content,
    ok: result.ok,
    data: result.data ?? null,
    details: result.details ?? null,
    error: result.error ?? null,
  };
}
