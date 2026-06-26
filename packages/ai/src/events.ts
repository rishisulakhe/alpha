import { z } from "zod/v4";
import { AssistantMessageSchema, ToolCallSchema } from "@alpha/agent";

// ---------------------------------------------------------------------------
// FinishReason — why the provider stopped streaming
// ---------------------------------------------------------------------------

export const FinishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_use",
  "error",
  "aborted",
]);

export type FinishReason = z.infer<typeof FinishReasonSchema>;

// ---------------------------------------------------------------------------
// Usage — token usage metadata
// ---------------------------------------------------------------------------

export const UsageSchema = z.strictObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
});

export type Usage = z.infer<typeof UsageSchema>;

// ---------------------------------------------------------------------------
// Provider events — streaming protocol between providers and the agent loop
// ---------------------------------------------------------------------------

export const ProviderResponseStartEventSchema = z.strictObject({
  type: z.literal("response_start"),
  model: z.string(),
});

export type ProviderResponseStartEvent = z.infer<typeof ProviderResponseStartEventSchema>;

export const ProviderRetryEventSchema = z.strictObject({
  type: z.literal("retry"),
  attempt: z.number(),
  maxAttempts: z.number(),
  delaySeconds: z.number(),
  message: z.string(),
});

export type ProviderRetryEvent = z.infer<typeof ProviderRetryEventSchema>;

export const ProviderTextDeltaEventSchema = z.strictObject({
  type: z.literal("text_delta"),
  text: z.string(),
});

export type ProviderTextDeltaEvent = z.infer<typeof ProviderTextDeltaEventSchema>;

export const ProviderThinkingDeltaEventSchema = z.strictObject({
  type: z.literal("thinking_delta"),
  text: z.string(),
});

export type ProviderThinkingDeltaEvent = z.infer<typeof ProviderThinkingDeltaEventSchema>;

export const ProviderToolCallEventSchema = z.strictObject({
  type: z.literal("tool_call"),
  call: ToolCallSchema,
});

export type ProviderToolCallEvent = z.infer<typeof ProviderToolCallEventSchema>;

export const ProviderResponseEndEventSchema = z.strictObject({
  type: z.literal("response_end"),
  message: AssistantMessageSchema,
  finishReason: z.string(),
  usage: UsageSchema.optional(),
});

export type ProviderResponseEndEvent = z.infer<typeof ProviderResponseEndEventSchema>;

export const ProviderErrorEventSchema = z.strictObject({
  type: z.literal("error"),
  message: z.string(),
  statusCode: z.number().optional(),
  recoverable: z.boolean(),
});

export type ProviderErrorEvent = z.infer<typeof ProviderErrorEventSchema>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const ProviderEventSchema = z.discriminatedUnion("type", [
  ProviderResponseStartEventSchema,
  ProviderRetryEventSchema,
  ProviderTextDeltaEventSchema,
  ProviderThinkingDeltaEventSchema,
  ProviderToolCallEventSchema,
  ProviderResponseEndEventSchema,
  ProviderErrorEventSchema,
]);

export type ProviderEvent = z.infer<typeof ProviderEventSchema>;
