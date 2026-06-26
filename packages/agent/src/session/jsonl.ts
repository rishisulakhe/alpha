import { SessionEntrySchema, type SessionEntry } from "./entries.ts";

// ---------------------------------------------------------------------------
// entryToJsonLine — serialize one session entry as a JSONL line
// ---------------------------------------------------------------------------

export function entryToJsonLine(entry: SessionEntry): string {
  return JSON.stringify(entry) + "\n";
}

// ---------------------------------------------------------------------------
// entryFromJsonLine — deserialize one JSONL line into a typed session entry
// ---------------------------------------------------------------------------

export function entryFromJsonLine(line: string): SessionEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    return SessionEntrySchema.parse(parsed);
  } catch {
    // Skip malformed or invalid lines silently
    return null;
  }
}

// ---------------------------------------------------------------------------
// entriesFromJsonLines — parse multiple lines from a full JSONL text
// ---------------------------------------------------------------------------

export function entriesFromJsonLines(text: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const line of text.split("\n")) {
    const entry = entryFromJsonLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}
