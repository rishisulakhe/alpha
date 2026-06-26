import type { AgentMessage } from "../messages.ts";
import type {
  CompactionEntry,
  SessionEntry,
  SessionInfoEntry,
} from "./entries.ts";
import { pathToEntry } from "./tree.ts";

// ---------------------------------------------------------------------------
// SessionState
// ---------------------------------------------------------------------------

export interface SessionState {
  messages: AgentMessage[];
  model: string | null;
  thinkingLevel: string | null;
  label: string | null;
  activeLeafId: string | null;
  sessionInfo: SessionInfoEntry | null;
  compactionEntries: CompactionEntry[];
}

// ---------------------------------------------------------------------------
// fromEntries — replay entries into runtime state
// ---------------------------------------------------------------------------

export function fromEntries(
  entries: SessionEntry[],
  leafId?: string | null,
): SessionState {
  const resolvedLeafId = leafId ?? null;
  const replayEntries = resolvedLeafId !== null
    ? pathToEntry(entries, resolvedLeafId)
    : entries;

  let messageRows: Array<{ entryId: string; message: AgentMessage }> = [];

  let model: string | null = null;
  let thinkingLevel: string | null = null;
  let label: string | null = null;
  let activeLeafId: string | null = resolvedLeafId;
  let sessionInfo: SessionInfoEntry | null = null;
  const compactionEntries: CompactionEntry[] = [];

  // Truncate entries before the latest branch summary
  const latestBranchIdx = _latestBranchSummaryIndex(replayEntries);
  const effectiveEntries = latestBranchIdx !== null
    ? replayEntries.slice(latestBranchIdx)
    : replayEntries;

  for (const entry of effectiveEntries) {
    switch (entry.type) {
      case "message":
        messageRows.push({ entryId: entry.id, message: entry.message });
        break;
      case "model_change":
        model = entry.model;
        break;
      case "thinking_level_change":
        thinkingLevel = entry.level;
        break;
      case "label":
        label = entry.label;
        break;
      case "leaf":
        activeLeafId = entry.entryId;
        break;
      case "session_info":
        sessionInfo = entry;
        break;
      case "compaction":
        compactionEntries.push(entry);
        messageRows = _applyCompaction(messageRows, entry);
        break;
      case "branch_summary":
        messageRows.push({
          entryId: entry.id,
          message: {
            role: "user",
            content: _formatBranchSummary(entry.summary),
          },
        });
        break;
      // Custom entries are collected by consumers; skip here
    }
  }

  return {
    messages: messageRows.map((row) => row.message),
    model,
    thinkingLevel,
    label,
    activeLeafId,
    sessionInfo,
    compactionEntries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _latestBranchSummaryIndex(entries: SessionEntry[]): number | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.type === "branch_summary") return i;
  }
  return null;
}

function _applyCompaction(
  messageRows: Array<{ entryId: string; message: AgentMessage }>,
  entry: CompactionEntry,
): Array<{ entryId: string; message: AgentMessage }> {
  const replacedIds = new Set(entry.replacesEntryIds);
  const retained: Array<{ entryId: string; message: AgentMessage }> = [];
  let insertedSummary = false;

  for (const row of messageRows) {
    if (!replacedIds.has(row.entryId)) {
      retained.push(row);
      continue;
    }
    if (!insertedSummary) {
      retained.push({
        entryId: entry.id,
        message: {
          role: "user",
          content: `Previous conversation summary:\n${entry.summary}`,
        },
      });
      insertedSummary = true;
    }
  }

  if (!insertedSummary) {
    retained.push({
      entryId: entry.id,
      message: {
        role: "user",
        content: `Previous conversation summary:\n${entry.summary}`,
      },
    });
  }

  return retained;
}

function _formatBranchSummary(summary: string): string {
  return (
    "The following is a summary of a branch that this conversation came back from:\n" +
    `<summary>\n${summary}\n</summary>`
  );
}
