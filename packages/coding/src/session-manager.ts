import { readdirSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AlphaPaths } from "./config/paths.ts";
import { getAlphaPaths, projectSessionDir } from "./config/paths.ts";
import { FsSessionStorage } from "@alpha/agent";

export interface SessionRecord {
  id: string;
  cwd: string;
  path: string;
  model?: string;
  providerName?: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export class SessionManager {
  private _paths: AlphaPaths;

  constructor(paths?: AlphaPaths) {
    this._paths = paths ?? getAlphaPaths();
  }

  listSessions(cwd?: string): SessionRecord[] {
    const records = cwd
      ? this._readProjectSessions(cwd)
      : this._readAllSessions();
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    for (const record of this.listSessions()) {
      if (record.id === sessionId) {
        return record;
      }
    }
    return undefined;
  }

  latestSessionForCwd(cwd: string): SessionRecord | undefined {
    return this.listSessions(cwd)[0];
  }

  createSession(cwd: string, model: string, providerName?: string): SessionRecord {
    const dir = projectSessionDir(cwd, this._paths);
    const fileName = FsSessionStorage.sessionFileName(cwd);
    const path = `${dir}/${fileName}`;
    const now = Date.now();

    return {
      id: fileName.split("_")[1]?.replace(".jsonl", "") ?? "",
      cwd,
      path,
      model,
      providerName,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    };
  }

  touchSession(id: string, opts?: { model?: string; providerName?: string; title?: string }): SessionRecord | null {
    const record = this.getSession(id);
    if (!record) return null;

    const updated: SessionRecord = {
      ...record,
      updatedAt: Date.now(),
      model: opts?.model ?? record.model,
      providerName: opts?.providerName ?? record.providerName,
      name: opts?.title ?? record.name,
    };
    return updated;
  }

  private _readProjectSessions(cwd: string): SessionRecord[] {
    const sessionDir = projectSessionDir(cwd, this._paths);
    return this._scanSessionDir(sessionDir);
  }

  private _readAllSessions(): SessionRecord[] {
    const records: SessionRecord[] = [];
    const sessionsDir = this._paths.sessionsDir;

    if (!existsSync(sessionsDir)) return records;

    try {
      const entries = readdirSync(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectDir = join(sessionsDir, entry.name);
        records.push(...this._scanSessionDir(projectDir));
      }
    } catch (err) {
      console.error("[alpha] SessionManager: failed to scan sessions:", err);
    }

    return this._deduplicate(records);
  }

  private _scanSessionDir(dir: string): SessionRecord[] {
    if (!existsSync(dir)) return [];

    const records: SessionRecord[] = [];
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const path = join(dir, file);
        const metadata = this._readSessionMetadata(path);
        if (metadata) {
          records.push(metadata);
        }
      }
    } catch (err) {
      console.error("[alpha] SessionManager: failed to scan session dir:", err);
    }

    return records;
  }

  private _readSessionMetadata(path: string): SessionRecord | null {
    try {
      const content = readFileSync(path, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      if (lines.length === 0) return null;

      const header = JSON.parse(lines[0]!);
      if (header.type !== "session") return null;

      let lastTimestamp = header.timestamp;
      let name: string | undefined;
      let messageCount = 0;

      for (const line of lines.slice(1)) {
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
        } catch (err) {
          console.error("[alpha] SessionManager: failed to parse session line:", err);
        }
      }

      return {
        id: header.id,
        cwd: header.cwd,
        path,
        createdAt: header.timestamp,
        updatedAt: lastTimestamp,
        messageCount,
        name,
      };
    } catch {
      return null;
    }
  }

  private _deduplicate(records: SessionRecord[]): SessionRecord[] {
    const byId = new Map<string, SessionRecord>();
    for (const record of records) {
      const existing = byId.get(record.id);
      if (!existing || record.updatedAt >= existing.updatedAt) {
        byId.set(record.id, record);
      }
    }
    return Array.from(byId.values());
  }
}
