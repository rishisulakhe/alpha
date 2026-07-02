import { mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import type { SessionEntry } from "./entries.ts";
import { entriesFromJsonLines, entryToJsonLine } from "./jsonl.ts";
import { SessionHeaderSchema, type SessionHeader, newEntryId, currentTimestamp, formatTimestamp } from "./entries.ts";

export interface SessionStorage {
  append(entry: SessionEntry): Promise<void>;
  readAll(): Promise<SessionEntry[]>;
}

export class InMemorySessionStorage implements SessionStorage {
  private _entries: SessionEntry[] = [];

  async append(entry: SessionEntry): Promise<void> {
    this._entries.push(entry);
  }

  async readAll(): Promise<SessionEntry[]> {
    return [...this._entries];
  }
}

export interface SessionMetadata {
  id: string;
  path: string;
  cwd: string;
  createdAt: number;
  modifiedAt: number;
  messageCount: number;
  name?: string;
}

export class FsSessionStorage implements SessionStorage {
  private _header: SessionHeader | null = null;
  private _entries: SessionEntry[] | null = null;

  constructor(private _path: string) {}

  get path(): string {
    return this._path;
  }

  get id(): string | undefined {
    return this._header?.id;
  }

  static sessionFileName(cwd: string, sessionId?: string): string {
    const id = sessionId ?? newEntryId();
    const ts = formatTimestamp();
    return `${ts}_${id}.jsonl`;
  }

  static encodeCwd(cwd: string): string {
    return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  }

  async ensureHeader(cwd: string): Promise<SessionHeader> {
    if (this._header) return this._header;

    const file = Bun.file(this._path);
    if (await file.exists()) {
      const lines = (await file.text()).split("\n").filter(Boolean);
      if (lines.length > 0) {
        const parsed = JSON.parse(lines[0]!);
        this._header = SessionHeaderSchema.parse(parsed);
        return this._header;
      }
    }

    const header: SessionHeader = {
      type: "session",
      version: 1,
      id: newEntryId(),
      timestamp: currentTimestamp(),
      cwd,
    };
    this._header = header;
    await this._writeHeader(header);
    return header;
  }

  async append(entry: SessionEntry): Promise<void> {
    const dir = dirname(this._path);
    mkdirSync(dir, { recursive: true });

    const file = Bun.file(this._path);
    const line = entryToJsonLine(entry);
    const existing = (await file.exists()) ? await file.text() : "";
    await Bun.write(this._path, existing + line);
    
    if (this._entries) {
      this._entries.push(entry);
    }
  }

  async readAll(): Promise<SessionEntry[]> {
    if (this._entries) return [...this._entries];

    const file = Bun.file(this._path);
    if (!(await file.exists())) {
      this._entries = [];
      return [];
    }
    const text = await file.text();
    const lines = text.split("\n").filter(Boolean);
    
    if (lines.length > 0 && lines[0]!.includes('"type":"session"')) {
      lines.shift();
    }
    
    this._entries = entriesFromJsonLines(lines.join("\n"));
    return [...this._entries];
  }

  async getMetadata(): Promise<SessionMetadata | null> {
    const file = Bun.file(this._path);
    if (!(await file.exists())) return null;

    const text = await file.text();
    const lines = text.split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    let header: SessionHeader;
    try {
      header = SessionHeaderSchema.parse(JSON.parse(lines[0]!));
    } catch {
      return null;
    }

    const entries = lines.slice(1);
    let lastTimestamp = header.timestamp;
    let name: string | undefined;
    let messageCount = 0;

    for (const line of entries) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.timestamp && parsed.timestamp > lastTimestamp) {
          lastTimestamp = parsed.timestamp;
        }
        if (parsed.type === "message") {
          messageCount++;
        }
        if (parsed.type === "session_info" && parsed.name) {
          name = parsed.name;
        }
      } catch {}
    }

    return {
      id: header.id,
      path: this._path,
      cwd: header.cwd,
      createdAt: header.timestamp,
      modifiedAt: lastTimestamp,
      messageCount,
      name,
    };
  }

  private async _writeHeader(header: SessionHeader): Promise<void> {
    const dir = dirname(this._path);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(header) + "\n";
    await Bun.write(this._path, line);
  }
}
