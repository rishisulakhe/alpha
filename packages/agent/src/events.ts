import { z } from "zod/v4";
import { AgentMessageSchema, ToolCallSchema } from "./messages.ts";
import type { AgentToolResult } from "./tools.ts";

// ---------------------------------------------------------------------------
// Agent Layer Events
// ---------------------------------------------------------------------------

export const AgentStartEventSchema = z.strictObject({
  type: z.literal("agent_start"),
});

export type AgentStartEvent = z.infer<typeof AgentStartEventSchema>;

// ---------------------------------------------------------------------------

export const AgentEndEventSchema = z.strictObject({
  type: z.literal("agent_end"),
});

export type AgentEndEvent = z.infer<typeof AgentEndEventSchema>;

// ---------------------------------------------------------------------------

export const TurnStartEventSchema = z.strictObject({
  type: z.literal("turn_start"),
  turn: z.number(),
});

export type TurnStartEvent = z.infer<typeof TurnStartEventSchema>;

// ---------------------------------------------------------------------------

export const TurnEndEventSchema = z.strictObject({
  type: z.literal("turn_end"),
  turn: z.number(),
});

export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;

// ---------------------------------------------------------------------------

export const RetryEventSchema = z.strictObject({
  type: z.literal("retry"),
  attempt: z.number(),
  maxAttempts: z.number(),
  delaySeconds: z.number(),
  message: z.string(),
});

export type RetryEvent = z.infer<typeof RetryEventSchema>;

// ---------------------------------------------------------------------------

export const QueueUpdateEventSchema = z.strictObject({
  type: z.literal("queue_update"),
  steering: z.array(z.string()),
  followUp: z.array(z.string()),
});

export type QueueUpdateEvent = z.infer<typeof QueueUpdateEventSchema>;

// ---------------------------------------------------------------------------

export const MessageStartEventSchema = z.strictObject({
  type: z.literal("message_start"),
  role: z.enum(["user", "assistant", "tool"]),
});

export type MessageStartEvent = z.infer<typeof MessageStartEventSchema>;

// ---------------------------------------------------------------------------

export const MessageDeltaEventSchema = z.strictObject({
  type: z.literal("message_delta"),
  text: z.string(),
});

export type MessageDeltaEvent = z.infer<typeof MessageDeltaEventSchema>;

// ---------------------------------------------------------------------------

export const ThinkingDeltaEventSchema = z.strictObject({
  type: z.literal("thinking_delta"),
  text: z.string(),
});

export type ThinkingDeltaEvent = z.infer<typeof ThinkingDeltaEventSchema>;

// ---------------------------------------------------------------------------

export const MessageEndEventSchema = z.strictObject({
  type: z.literal("message_end"),
  message: AgentMessageSchema,
});

export type MessageEndEvent = z.infer<typeof MessageEndEventSchema>;

// ---------------------------------------------------------------------------

export const ToolExecutionStartEventSchema = z.strictObject({
  type: z.literal("tool_execution_start"),
  call: ToolCallSchema,
});

export type ToolExecutionStartEvent = z.infer<typeof ToolExecutionStartEventSchema>;

// ---------------------------------------------------------------------------

export const ToolExecutionUpdateEventSchema = z.strictObject({
  type: z.literal("tool_execution_update"),
  message: z.string(),
});

export type ToolExecutionUpdateEvent = z.infer<typeof ToolExecutionUpdateEventSchema>;

// ---------------------------------------------------------------------------

// AgentToolResult is a plain interface (not a Zod schema), so we use a
// loose object schema for runtime validation.
const AgentToolResultDataSchema: z.ZodType<AgentToolResult> = z.strictObject({
  toolCallId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
}) as z.ZodType<AgentToolResult>;

export const ToolExecutionEndEventSchema = z.strictObject({
  type: z.literal("tool_execution_end"),
  result: AgentToolResultDataSchema,
});

export type ToolExecutionEndEvent = z.infer<typeof ToolExecutionEndEventSchema>;

// ---------------------------------------------------------------------------

export const ErrorEventSchema = z.strictObject({
  type: z.literal("error"),
  message: z.string(),
  recoverable: z.boolean(),
  statusCode: z.number().optional(),
});

export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const AgentEventSchema = z.discriminatedUnion("type", [
  AgentStartEventSchema,
  AgentEndEventSchema,
  TurnStartEventSchema,
  TurnEndEventSchema,
  RetryEventSchema,
  QueueUpdateEventSchema,
  MessageStartEventSchema,
  MessageDeltaEventSchema,
  ThinkingDeltaEventSchema,
  MessageEndEventSchema,
  ToolExecutionStartEventSchema,
  ToolExecutionUpdateEventSchema,
  ToolExecutionEndEventSchema,
  ErrorEventSchema,
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isMessageEndEvent(ev: AgentEvent): ev is MessageEndEvent {
  return ev.type === "message_end";
}

export function isToolExecutionEndEvent(ev: AgentEvent): ev is ToolExecutionEndEvent {
  return ev.type === "tool_execution_end";
}

export function isToolExecutionStartEvent(ev: AgentEvent): ev is ToolExecutionStartEvent {
  return ev.type === "tool_execution_start";
}

export function isErrorEvent(ev: AgentEvent): ev is ErrorEvent {
  return ev.type === "error";
}

export function isThinkingDeltaEvent(ev: AgentEvent): ev is ThinkingDeltaEvent {
  return ev.type === "thinking_delta";
}

export function isMessageDeltaEvent(ev: AgentEvent): ev is MessageDeltaEvent {
  return ev.type === "message_delta";
}

export function isTurnStartEvent(ev: AgentEvent): ev is TurnStartEvent {
  return ev.type === "turn_start";
}

export function isTurnEndEvent(ev: AgentEvent): ev is TurnEndEvent {
  return ev.type === "turn_end";
}
