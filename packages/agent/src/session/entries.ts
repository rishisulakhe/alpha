import { z } from "zod/v4";
import { AgentMessageSchema } from "../messages.ts";
import type { JSONObject } from "../types/json.ts";

export function newEntryId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function currentTimestamp(): number {
  return Date.now() / 1000;
}

export function formatTimestamp(ts?: number): string {
  const date = ts ? new Date(ts * 1000) : new Date();
  return date.toISOString().replace(/[:.]/g, "-");
}

const baseFields = {
  id: z.string().default(() => newEntryId()),
  parentId: z.string().nullable().default(null),
  timestamp: z.number().default(() => currentTimestamp()),
};

export const SessionHeaderSchema = z.strictObject({
  type: z.literal("session"),
  version: z.literal(1),
  id: z.string(),
  timestamp: z.number(),
  cwd: z.string(),
});

export type SessionHeader = z.infer<typeof SessionHeaderSchema>;

export const MessageEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("message"),
  message: AgentMessageSchema,
});

export type MessageEntry = z.infer<typeof MessageEntrySchema>;

export const ModelChangeEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("model_change"),
  model: z.string(),
  providerName: z.string().optional(),
});

export type ModelChangeEntry = z.infer<typeof ModelChangeEntrySchema>;

export const ThinkingLevelChangeEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("thinking_level_change"),
  level: z.string(),
});

export type ThinkingLevelChangeEntry = z.infer<typeof ThinkingLevelChangeEntrySchema>;

export const CompactionEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("compaction"),
  summary: z.string(),
  replacesEntryIds: z.array(z.string()).default([]),
  tokensBefore: z.number().optional(),
  tokensAfter: z.number().optional(),
});

export type CompactionEntry = z.infer<typeof CompactionEntrySchema>;

export const BranchSummaryEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("branch_summary"),
  summary: z.string(),
});

export type BranchSummaryEntry = z.infer<typeof BranchSummaryEntrySchema>;

export const LabelEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("label"),
  label: z.string(),
});

export type LabelEntry = z.infer<typeof LabelEntrySchema>;

export const LeafEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("leaf"),
  entryId: z.string(),
});

export type LeafEntry = z.infer<typeof LeafEntrySchema>;

export const SessionInfoEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("session_info"),
  cwd: z.string(),
  name: z.string().optional(),
  title: z.string().optional(),
  createdAt: z.string().optional(),
});

export type SessionInfoEntry = z.infer<typeof SessionInfoEntrySchema>;

export const CustomEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("custom"),
  namespace: z.string(),
  data: z.record(z.string(), z.unknown()) as z.ZodType<JSONObject>,
});

export type CustomEntry = z.infer<typeof CustomEntrySchema>;

export const SessionEntrySchema = z.discriminatedUnion("type", [
  MessageEntrySchema,
  ModelChangeEntrySchema,
  ThinkingLevelChangeEntrySchema,
  CompactionEntrySchema,
  BranchSummaryEntrySchema,
  LabelEntrySchema,
  LeafEntrySchema,
  SessionInfoEntrySchema,
  CustomEntrySchema,
]);

export type SessionEntry = z.infer<typeof SessionEntrySchema>;
