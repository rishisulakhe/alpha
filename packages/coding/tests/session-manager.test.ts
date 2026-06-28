import { describe, expect, test } from "bun:test";
import { SessionManager, type SessionRecord } from "../src/session-manager.ts";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("SessionManager", () => {
  test("creates and lists sessions", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sm = new SessionManager({
      home: tmpDir,
      agentsHome: tmpDir,
      sessionsDir,
      logsDir: path.join(tmpDir, "logs"),
      userSkillsDir: path.join(tmpDir, "skills"),
      userPromptsDir: path.join(tmpDir, "prompts"),
      userAgentsMd: path.join(tmpDir, "AGENTS.md"),
      providersFile: path.join(tmpDir, "providers.json"),
      credentialsFile: path.join(tmpDir, "credentials.json"),
      tuiSettingsFile: path.join(tmpDir, "tui.json"),
    });
    try {
      const s = sm.createSession("/home/user/my-project", "gpt-4", "openai", "My Session");
      expect(s.id).toBeTypeOf("string");
      expect(s.cwd).toBe("/home/user/my-project");
      expect(s.model).toBe("gpt-4");

      const list = sm.listSessions();
      expect(list.length).toBe(1);
      expect(list[0]!.id).toBe(s.id);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("listSessions filters by cwd", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-filter-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sm = new SessionManager({
      home: tmpDir, agentsHome: tmpDir, sessionsDir,
      logsDir: path.join(tmpDir, "logs"), userSkillsDir: path.join(tmpDir, "skills"),
      userPromptsDir: path.join(tmpDir, "prompts"), userAgentsMd: path.join(tmpDir, "AGENTS.md"),
      providersFile: path.join(tmpDir, "providers.json"), credentialsFile: path.join(tmpDir, "credentials.json"),
      tuiSettingsFile: path.join(tmpDir, "tui.json"),
    });
    try {
      sm.createSession("/home/user/proj-a", "gpt-4", "openai");
      sm.createSession("/home/user/proj-b", "claude", "anthropic");

      expect(sm.listSessions("/home/user/proj-a").length).toBe(1);
      expect(sm.listSessions("/home/user/proj-b").length).toBe(1);
      expect(sm.listSessions("/home/user/nonexistent").length).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("latestSessionForCwd returns most recently updated", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-latest-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sm = new SessionManager({
      home: tmpDir, agentsHome: tmpDir, sessionsDir,
      logsDir: path.join(tmpDir, "logs"), userSkillsDir: path.join(tmpDir, "skills"),
      userPromptsDir: path.join(tmpDir, "prompts"), userAgentsMd: path.join(tmpDir, "AGENTS.md"),
      providersFile: path.join(tmpDir, "providers.json"), credentialsFile: path.join(tmpDir, "credentials.json"),
      tuiSettingsFile: path.join(tmpDir, "tui.json"),
    });
    try {
      sm.createSession("/home/user/proj", "gpt-4", "openai");
      const s2 = sm.createSession("/home/user/proj", "gpt-5", "openai");
      // Touch the sessions to ensure distinct timestamps
      sm.touchSession(s2.id, {});
      const latest = sm.latestSessionForCwd("/home/user/proj");
      expect(latest).toBeDefined();
      expect(latest!.model).toBe("gpt-5");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("touchSession updates metadata", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-touch-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sm = new SessionManager({
      home: tmpDir, agentsHome: tmpDir, sessionsDir,
      logsDir: path.join(tmpDir, "logs"), userSkillsDir: path.join(tmpDir, "skills"),
      userPromptsDir: path.join(tmpDir, "prompts"), userAgentsMd: path.join(tmpDir, "AGENTS.md"),
      providersFile: path.join(tmpDir, "providers.json"), credentialsFile: path.join(tmpDir, "credentials.json"),
      tuiSettingsFile: path.join(tmpDir, "tui.json"),
    });
    try {
      const s = sm.createSession("/home/user/proj", "gpt-4", "openai");
      sm.touchSession(s.id, { model: "gpt-5", title: "Updated" });
      const updated = sm.getSession(s.id);
      expect(updated).toBeDefined();
      expect(updated!.model).toBe("gpt-5");
      expect(updated!.title).toBe("Updated");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("getDefaultSession creates one if none exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-default-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sm = new SessionManager({
      home: tmpDir, agentsHome: tmpDir, sessionsDir,
      logsDir: path.join(tmpDir, "logs"), userSkillsDir: path.join(tmpDir, "skills"),
      userPromptsDir: path.join(tmpDir, "prompts"), userAgentsMd: path.join(tmpDir, "AGENTS.md"),
      providersFile: path.join(tmpDir, "providers.json"), credentialsFile: path.join(tmpDir, "credentials.json"),
      tuiSettingsFile: path.join(tmpDir, "tui.json"),
    });
    try {
      const s = sm.getDefaultSession("/home/user/proj", "gpt-4", "openai");
      expect(s.cwd).toBe("/home/user/proj");
      // Calling again should return the same session
      const s2 = sm.getDefaultSession("/home/user/proj", "gpt-4", "openai");
      expect(s2.id).toBe(s.id);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("getSession returns undefined for unknown id", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-sm-unk-"));
    const sessionsDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sm = new SessionManager({
      home: tmpDir, agentsHome: tmpDir, sessionsDir,
      logsDir: path.join(tmpDir, "logs"), userSkillsDir: path.join(tmpDir, "skills"),
      userPromptsDir: path.join(tmpDir, "prompts"), userAgentsMd: path.join(tmpDir, "AGENTS.md"),
      providersFile: path.join(tmpDir, "providers.json"), credentialsFile: path.join(tmpDir, "credentials.json"),
      tuiSettingsFile: path.join(tmpDir, "tui.json"),
    });
    try {
      expect(sm.getSession("nonexistent")).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
