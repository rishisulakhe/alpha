import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import type { AlphaPaths } from "./config/paths.ts";
import { getAlphaPaths, projectSessionDir } from "./config/paths.ts";

// ---------------------------------------------------------------------------
// SessionRecord
// ---------------------------------------------------------------------------

export interface SessionRecord {
  /** Unique session identifier */
  id: string;
  /** Working directory for the session */
  cwd: string;
  /** Path to the session data file */
  path: string;
  /** Model identifier */
  model: string;
  /** Provider name */
  providerName?: string;
  /** Optional user-provided title */
  title?: string;
  /** Creation timestamp (Unix epoch seconds) */
  createdAt: number;
  /** Last update timestamp (Unix epoch seconds) */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * Manages session records and indexes.
 *
 * Sessions are stored in per-project directories with JSONL index files.
 * The manager supports:
 * - Listing sessions (project-scoped or global)
 * - Creating new sessions
 * - Getting/resuming existing sessions
 * - Updating session metadata
 */
export class SessionManager {
  private _paths: AlphaPaths;

  constructor(paths?: AlphaPaths) {
    this._paths = paths ?? getAlphaPaths();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * List sessions, newest first.
   * When cwd is provided, only sessions for that directory are returned.
   */
  listSessions(cwd?: string): SessionRecord[] {
    const records = cwd
      ? this._readProjectRecords(cwd)
      : this._readAllRecords();
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): SessionRecord | undefined {
    for (const record of this._readAllRecords()) {
      if (record.id === sessionId) {
        return record;
      }
    }
    return undefined;
  }

  /**
   * Get the most recently updated session for a working directory.
   */
  latestSessionForCwd(cwd: string): SessionRecord | undefined {
    const records = this.listSessions(cwd);
    return records[0];
  }

  /**
   * Create a new session record.
   */
  createSession(opts: {
    cwd: string;
    model: string;
    providerName?: string;
    title?: string;
    sessionId?: string;
  }): SessionRecord {
    const now = Date.now() / 1000;
    const resolvedCwd = opts.cwd;
    const id = opts.sessionId ?? _newId();
    const projectDir = projectSessionDir(resolvedCwd, this._paths);
    const sessionPath = join(projectDir, `${id}.jsonl`);

    const record: SessionRecord = {
      id,
      cwd: resolvedCwd,
      path: sessionPath,
      model: opts.model,
      providerName: opts.providerName,
      title: opts.title,
      createdAt: now,
      updatedAt: now,
    };

    this._upsert(record);
    return record;
  }

  /**
   * Get or create the default session for a project.
   */
  getOrCreateDefaultSession(opts: {
    cwd: string;
    model: string;
    providerName?: string;
  }): SessionRecord {
    const resolvedCwd = opts.cwd;
    const projectDir = projectSessionDir(resolvedCwd, this._paths);
    const projectHash = basename(projectDir);
    const sessionId = `default-${projectHash}`;

    const existing = this.getSession(sessionId);
    if (existing) {
      return existing;
    }

    const now = Date.now() / 1000;
    const sessionPath = join(projectDir, `${sessionId}.jsonl`);

    const record: SessionRecord = {
      id: sessionId,
      cwd: resolvedCwd,
      path: sessionPath,
      model: opts.model,
      providerName: opts.providerName,
      title: "Default session",
      createdAt: now,
      updatedAt: now,
    };

    this._upsert(record);
    return record;
  }

  /**
   * Update a session's metadata.
   */
  touchSession(
    sessionId: string,
    updates: {
      model?: string;
      providerName?: string;
      title?: string;
    },
  ): SessionRecord | undefined {
    const existing = this.getSession(sessionId);
    if (!existing) {
      return undefined;
    }

    const updated: SessionRecord = {
      ...existing,
      model: updates.model ?? existing.model,
      providerName: updates.providerName ?? existing.providerName,
      title: updates.title ?? existing.title,
      updatedAt: Date.now() / 1000,
    };

    this._upsert(updated);
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Legacy compatibility
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Use getOrCreateDefaultSession instead
   */
  getDefaultSession(cwd: string, model: string, providerName: string): SessionRecord {
    return this.getOrCreateDefaultSession({ cwd, model, providerName });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _globalIndexPath(): string {
    return join(this._paths.sessionsDir, "index.jsonl");
  }

  private _projectIndexPath(cwd: string): string {
    return join(projectSessionDir(cwd, this._paths), "index.jsonl");
  }

  private _readIndex(indexPath: string): SessionRecord[] {
    if (!existsSync(indexPath)) {
      return [];
    }

    const records: SessionRecord[] = [];
    try {
      const text = readFileSync(indexPath, "utf-8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          // Convert ISO strings to numbers if needed (legacy support)
          if (typeof parsed.createdAt === "string") {
            parsed.createdAt = new Date(parsed.createdAt).getTime() / 1000;
          }
          if (typeof parsed.updatedAt === "string") {
            parsed.updatedAt = new Date(parsed.updatedAt).getTime() / 1000;
          }
          records.push(parsed as SessionRecord);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      return [];
    }

    return records;
  }

  private _readProjectRecords(cwd: string): SessionRecord[] {
    const resolvedCwd = cwd;
    const records = this._readIndex(this._projectIndexPath(resolvedCwd));

    // Also include records from global index for this cwd (legacy support)
    const globalRecords = this._readIndex(this._globalIndexPath());
    for (const record of globalRecords) {
      if (record.cwd === resolvedCwd) {
        records.push(record);
      }
    }

    return _deduplicateRecords(records);
  }

  private _readAllRecords(): SessionRecord[] {
    const records = this._readIndex(this._globalIndexPath());

    // Also scan project directories
    try {
      const sessionsDir = this._paths.sessionsDir;
      if (existsSync(sessionsDir)) {
        for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const projectIndexPath = join(sessionsDir, entry.name, "index.jsonl");
          if (existsSync(projectIndexPath)) {
            records.push(...this._readIndex(projectIndexPath));
          }
        }
      }
    } catch {
      // Ignore errors scanning directories
    }

    return _deduplicateRecords(records);
  }

  private _writeIndex(indexPath: string, records: SessionRecord[]): void {
    mkdirSync(dirname(indexPath), { recursive: true });
    const content = records.map((r) => JSON.stringify(r)).join("\n");
    writeFileSync(indexPath, content + (content ? "\n" : ""), "utf-8");
  }

  private _upsert(record: SessionRecord): void {
    const projectDir = projectSessionDir(record.cwd, this._paths);
    const indexPath = join(projectDir, "index.jsonl");
    mkdirSync(projectDir, { recursive: true });

    const records = this._readIndex(indexPath).filter((r) => r.id !== record.id);
    records.push(record);
    this._writeIndex(indexPath, records);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function _deduplicateRecords(records: SessionRecord[]): SessionRecord[] {
  const byId = new Map<string, SessionRecord>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (!existing || record.updatedAt >= existing.updatedAt) {
      byId.set(record.id, record);
    }
  }
  return Array.from(byId.values());
}
