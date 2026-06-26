import { z } from "zod/v4";
import { AgentMessageSchema } from "../messages.ts";
import type { JSONObject } from "../types/json.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function newEntryId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function currentTimestamp(): number {
  return Date.now() / 1000;
}

// ---------------------------------------------------------------------------
// Base entry fields — shared by all entry types
// ---------------------------------------------------------------------------

const baseFields = {
  id: z.string().default(() => newEntryId()),
  parentId: z.string().nullable().default(null),
  timestamp: z.number().default(() => currentTimestamp()),
};

// ---------------------------------------------------------------------------
// 1. MessageEntry
// ---------------------------------------------------------------------------

export const MessageEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("message"),
  message: AgentMessageSchema,
});

export type MessageEntry = z.infer<typeof MessageEntrySchema>;

// ---------------------------------------------------------------------------
// 2. ModelChangeEntry
// ---------------------------------------------------------------------------

export const ModelChangeEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("model_change"),
  model: z.string(),
  providerName: z.string().optional(),
});

export type ModelChangeEntry = z.infer<typeof ModelChangeEntrySchema>;

// ---------------------------------------------------------------------------
// 3. ThinkingLevelChangeEntry
// ---------------------------------------------------------------------------

export const ThinkingLevelChangeEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("thinking_level_change"),
  level: z.string(),
});

export type ThinkingLevelChangeEntry = z.infer<typeof ThinkingLevelChangeEntrySchema>;

// ---------------------------------------------------------------------------
// 4. CompactionEntry
// ---------------------------------------------------------------------------

export const CompactionEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("compaction"),
  summary: z.string(),
  replacesEntryIds: z.array(z.string()).default([]),
});

export type CompactionEntry = z.infer<typeof CompactionEntrySchema>;

// ---------------------------------------------------------------------------
// 5. BranchSummaryEntry
// ---------------------------------------------------------------------------

export const BranchSummaryEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("branch_summary"),
  summary: z.string(),
});

export type BranchSummaryEntry = z.infer<typeof BranchSummaryEntrySchema>;

// ---------------------------------------------------------------------------
// 6. LabelEntry
// ---------------------------------------------------------------------------

export const LabelEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("label"),
  label: z.string(),
});

export type LabelEntry = z.infer<typeof LabelEntrySchema>;

// ---------------------------------------------------------------------------
// 7. LeafEntry
// ---------------------------------------------------------------------------

export const LeafEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("leaf"),
  entryId: z.string(),
});

export type LeafEntry = z.infer<typeof LeafEntrySchema>;

// ---------------------------------------------------------------------------
// 8. SessionInfoEntry
// ---------------------------------------------------------------------------

export const SessionInfoEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("session_info"),
  cwd: z.string(),
  title: z.string().optional(),
  createdAt: z.string(),
});

export type SessionInfoEntry = z.infer<typeof SessionInfoEntrySchema>;

// ---------------------------------------------------------------------------
// 9. CustomEntry
// ---------------------------------------------------------------------------

export const CustomEntrySchema = z.strictObject({
  ...baseFields,
  type: z.literal("custom"),
  namespace: z.string(),
  data: z.record(z.string(), z.unknown()) as z.ZodType<JSONObject>,
});

export type CustomEntry = z.infer<typeof CustomEntrySchema>;

// ---------------------------------------------------------------------------
// SessionEntry — discriminated union
// ---------------------------------------------------------------------------

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
