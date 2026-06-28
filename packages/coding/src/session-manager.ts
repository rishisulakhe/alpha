import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AlphaPaths } from "./config/paths.ts";
import { getAlphaPaths, projectSessionDir, projectSlug, projectHash } from "./config/paths.ts";

// ---------------------------------------------------------------------------
// SessionRecord
// ---------------------------------------------------------------------------

export interface SessionRecord {
  id: string;
  cwd: string;
  path: string;
  model: string;
  providerName: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private _indexPath: string;
  private _paths: AlphaPaths;

  constructor(paths?: AlphaPaths) {
    this._paths = paths ?? getAlphaPaths();
    this._indexPath = join(this._paths.sessionsDir, "index.jsonl");
  }

  listSessions(cwd?: string): SessionRecord[] {
    const all = this._readIndex();
    if (!cwd) return all;
    return all.filter((s) => s.cwd === cwd);
  }

  latestSessionForCwd(cwd: string): SessionRecord | undefined {
    const sessions = this.listSessions(cwd);
    return sessions[0]; // Already sorted by updatedAt desc
  }

  createSession(
    cwd: string,
    model: string,
    providerName: string,
    title?: string,
  ): SessionRecord {
    const id = _newId();
    const dir = projectSessionDir(cwd);
    const record: SessionRecord = {
      id,
      cwd,
      path: join(dir, `${id}.jsonl`),
      model,
      providerName,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Create directory
    mkdirSync(dir, { recursive: true });

    // Append to index
    this._appendToIndex(record);
    return record;
  }

  getDefaultSession(cwd: string, model: string, providerName: string): SessionRecord {
    const existing = this.latestSessionForCwd(cwd);
    if (existing) return existing;
    return this.createSession(cwd, model, providerName);
  }

  touchSession(sessionId: string, updates: Partial<SessionRecord>): void {
    const records = this._readIndex();
    const idx = records.findIndex((r) => r.id === sessionId);
    if (idx === -1) return;

    records[idx] = {
      ...records[idx]!,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this._writeIndex(records);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this._readIndex().find((r) => r.id === sessionId);
  }

  // -- Private ---------------------------------------------------------------

  private _readIndex(): SessionRecord[] {
    if (!existsSync(this._indexPath)) return [];
    try {
      const text = readFileSync(this._indexPath, "utf-8");
      const records: SessionRecord[] = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed));
        } catch { /* skip malformed */ }
      }
      // Sort by updatedAt descending, then createdAt descending
      records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
      return records;
    } catch {
      return [];
    }
  }

  private _writeIndex(records: SessionRecord[]): void {
    mkdirSync(dirname(this._indexPath), { recursive: true });
    const lines = records.map((r) => JSON.stringify(r) + "\n").join("");
    writeFileSync(this._indexPath, lines, "utf-8");
  }

  private _appendToIndex(record: SessionRecord): void {
    mkdirSync(dirname(this._indexPath), { recursive: true });
    const line = JSON.stringify(record) + "\n";
    if (existsSync(this._indexPath)) {
      writeFileSync(this._indexPath, readFileSync(this._indexPath, "utf-8") + line, "utf-8");
    } else {
      writeFileSync(this._indexPath, line, "utf-8");
    }
  }
}

function _newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
