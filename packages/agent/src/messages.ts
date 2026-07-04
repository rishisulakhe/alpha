import { z } from "zod/v4";
import type { JSONObject } from "./types/json.ts";

// ToolCall — needed by AssistantMessage; shared with the tools module

export const ToolCallSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()) as z.ZodType<JSONObject>,
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// Message schemas (provider-neutral)

//UserMessage
export const UserMessageSchema = z.strictObject({
  role: z.literal("user"),
  content: z.string(),
});

export type UserMessage = z.infer<typeof UserMessageSchema>;

// AssistantMessage
export const AssistantMessageSchema = z.strictObject({
  role: z.literal("assistant"),
  content: z.string().default(""),
  tool_calls: z.array(ToolCallSchema).default([]),
});

export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

// ToolResultMessage
export const ToolResultMessageSchema = z.strictObject({
  role: z.literal("tool"),
  tool_call_id: z.string(),
  name: z.string(),
  content: z.string(),
  ok: z.boolean().default(true),
  data: z.record(z.string(), z.unknown()).nullable().default(null) as z.ZodType<JSONObject | null>,
  details: z.record(z.string(), z.unknown()).nullable().default(null) as z.ZodType<JSONObject | null>,
  error: z.string().nullable().default(null),
});

export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;

// Discriminated union

export const AgentMessageSchema = z.discriminatedUnion("role", [
  UserMessageSchema,
  AssistantMessageSchema,
  ToolResultMessageSchema,
]);

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// Type guards

export function isUserMessage(msg: AgentMessage): msg is UserMessage {
  return msg.role === "user";
}

export function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
  return msg.role === "assistant";
}

export function isToolResultMessage(msg: AgentMessage): msg is ToolResultMessage {
  return msg.role === "tool";
}
