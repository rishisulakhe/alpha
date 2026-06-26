import type { SessionEntry } from "./entries.ts";
import { entriesFromJsonLines, entryToJsonLine } from "./jsonl.ts";

// ---------------------------------------------------------------------------
// SessionStorage protocol
// ---------------------------------------------------------------------------

export interface SessionStorage {
  append(entry: SessionEntry): Promise<void>;
  readAll(): Promise<SessionEntry[]>;
}

// ---------------------------------------------------------------------------
// InMemorySessionStorage — for testing
// ---------------------------------------------------------------------------

export class InMemorySessionStorage implements SessionStorage {
  private _entries: SessionEntry[] = [];

  async append(entry: SessionEntry): Promise<void> {
    this._entries.push(entry);
  }

  async readAll(): Promise<SessionEntry[]> {
    return [...this._entries];
  }
}

// ---------------------------------------------------------------------------
// FsSessionStorage — local append-only JSONL file
// ---------------------------------------------------------------------------

export class FsSessionStorage implements SessionStorage {
  constructor(private _path: string) {}

  async append(entry: SessionEntry): Promise<void> {
    const file = Bun.file(this._path);
    const line = entryToJsonLine(entry);
    const existing = (await file.exists())
      ? await file.text()
      : "";
    await Bun.write(this._path, existing + line);
  }

  async readAll(): Promise<SessionEntry[]> {
    const file = Bun.file(this._path);
    if (!(await file.exists())) return [];
    const text = await file.text();
    return entriesFromJsonLines(text);
  }
}
