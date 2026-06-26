import type { SessionEntry } from "./entries.ts";

// ---------------------------------------------------------------------------
// entriesById — index entries by id, rejecting duplicates
// ---------------------------------------------------------------------------

export function entriesById(entries: SessionEntry[]): Map<string, SessionEntry> {
  const result = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (result.has(entry.id)) {
      throw new Error(`Duplicate session entry id: ${entry.id}`);
    }
    result.set(entry.id, entry);
  }
  return result;
}

// ---------------------------------------------------------------------------
// pathToEntry — return the root-to-leaf path for a given leaf entry id
// ---------------------------------------------------------------------------

export function pathToEntry(
  entries: SessionEntry[],
  leafId: string,
): SessionEntry[] {
  const byId = entriesById(entries);
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | null = leafId;

  while (currentId !== null) {
    if (seen.has(currentId)) {
      throw new Error(`Cycle detected at session entry: ${currentId}`);
    }
    seen.add(currentId);

    const entry = byId.get(currentId);
    if (!entry) {
      throw new Error(`Missing session entry: ${currentId}`);
    }

    path.push(entry);
    currentId = entry.parentId;
  }

  path.reverse();
  return path;
}

// ---------------------------------------------------------------------------
// activeLeafId — find the last LeafEntry and return its entryId
// ---------------------------------------------------------------------------

export function activeLeafId(entries: SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type === "leaf") {
      return entry.entryId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// branchableEntries — return entries that can be branched from
// ---------------------------------------------------------------------------

export function branchableEntries(entries: SessionEntry[]): SessionEntry[] {
  const branchable: SessionEntry[] = [];

  for (const entry of entries) {
    if (entry.type === "message") {
      branchable.push(entry);
    }
  }

  return branchable;
}
