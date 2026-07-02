import { describe, expect, test } from "bun:test";
import { SessionManager, type SessionRecord } from "../src/session-manager.ts";
import { FsSessionStorage } from "@alpha/agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function makePaths(tmpDir: string) {
  return {
    home: tmpDir,
    agentsHome: tmpDir,
    sessionsDir: path.join(tmpDir, "sessions"),
    logsDir: path.join(tmpDir, "logs"),
    userSkillsDir: path.join(tmpDir, "skills"),
    userPromptsDir: path.join(tmpDir, "prompts"),
    userAgentsMd: path.join(tmpDir, "AGENTS.md"),
    providersFile: path.join(tmpDir, "providers.json"),
    credentialsFile: path.join(tmpDir, "credentials.json"),
    tuiSettingsFile: path.join(tmpDir, "tui.json"),
  };
}

async function createTestSession(
  sessionsDir: string,
  cwd: string,
  id?: string,
): Promise<string> {
  const encodedCwd = FsSessionStorage.encodeCwd(cwd);
  const sessionDir = path.join(sessionsDir, encodedCwd);
  fs.mkdirSync(sessionDir, { recursive: true });

  const fileName = FsSessionStorage.sessionFileName(cwd);
  const sessionPath = path.join(sessionDir, fileName);

  const header = {
    type: "session",
    version: 1,
    id: id ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16),
    timestamp: Date.now() / 1000,
    cwd,
  };

  fs.writeFileSync(sessionPath, JSON.stringify(header) + "\n");
  return sessionPath;
}

describe("SessionManager", () => {
  test("discovers sessions from filesystem", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-"));
    const paths = makePaths(tmpDir);
    fs.mkdirSync(paths.sessionsDir, { recursive: true });

    const sm = new SessionManager(paths);
    try {
      await createTestSession(paths.sessionsDir, "/home/user/my-project");

      const list = sm.listSessions();
      expect(list.length).toBe(1);
      expect(list[0]!.cwd).toBe("/home/user/my-project");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("listSessions filters by cwd", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-filter-"));
    const paths = makePaths(tmpDir);
    fs.mkdirSync(paths.sessionsDir, { recursive: true });

    const sm = new SessionManager(paths);
    try {
      await createTestSession(paths.sessionsDir, "/home/user/proj-a");
      await createTestSession(paths.sessionsDir, "/home/user/proj-b");

      expect(sm.listSessions("/home/user/proj-a").length).toBe(1);
      expect(sm.listSessions("/home/user/proj-b").length).toBe(1);
      expect(sm.listSessions("/home/user/nonexistent").length).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("latestSessionForCwd returns a session for the cwd", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-latest-"));
    const paths = makePaths(tmpDir);
    fs.mkdirSync(paths.sessionsDir, { recursive: true });

    const sm = new SessionManager(paths);
    try {
      await createTestSession(paths.sessionsDir, "/home/user/proj");
      const latest = sm.latestSessionForCwd("/home/user/proj");
      expect(latest).toBeDefined();
      expect(latest!.cwd).toBe("/home/user/proj");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("getSession returns undefined for unknown id", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-unk-"));
    const paths = makePaths(tmpDir);
    fs.mkdirSync(paths.sessionsDir, { recursive: true });

    const sm = new SessionManager(paths);
    try {
      expect(sm.getSession("nonexistent")).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
