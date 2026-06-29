import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";

const HOME = join(homedir(), ".alpha");
const AGENTS_HOME = join(homedir(), ".agents");

export interface AlphaPaths {
  home: string;
  agentsHome: string;
  sessionsDir: string;
  logsDir: string;
  userSkillsDir: string;
  userPromptsDir: string;
  userAgentsMd: string;
  providersFile: string;
  credentialsFile: string;
  tuiSettingsFile: string;
}

export function getAlphaPaths(): AlphaPaths {
  return {
    home: HOME,
    agentsHome: AGENTS_HOME,
    sessionsDir: join(HOME, "sessions"),
    logsDir: join(HOME, "logs"),
    userSkillsDir: join(HOME, "skills"),
    userPromptsDir: join(HOME, "prompts"),
    userAgentsMd: join(HOME, "AGENTS.md"),
    providersFile: join(HOME, "providers.json"),
    credentialsFile: join(HOME, "credentials.json"),
    tuiSettingsFile: join(HOME, "tui.json"),
  };
}

export function ensureAlphaDirectories(): void {
  const paths = getAlphaPaths();
  const dirs = [paths.home, paths.sessionsDir, paths.logsDir, paths.userSkillsDir, paths.userPromptsDir];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function projectHash(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 6);
}

export function projectSlug(cwd: string): string {
  return cwd
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/[^a-zA-Z0-9\/_-]/g, "_")
    .replace(/\//g, "-");
}

export function projectSessionDir(cwd: string): string {
  const slug = projectSlug(cwd);
  const hash = projectHash(cwd);
  return join(HOME, "sessions", `${slug}-${hash}`);
}

export function defaultSessionPath(cwd: string): string {
  return join(projectSessionDir(cwd), "default.jsonl");
}
