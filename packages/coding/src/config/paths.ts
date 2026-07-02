import { homedir } from "node:os";
import { join } from "node:path";
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

export function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function projectSessionDir(cwd: string, paths?: AlphaPaths): string {
  const encoded = encodeCwd(cwd);
  const sessionsDir = paths?.sessionsDir ?? join(HOME, "sessions");
  return join(sessionsDir, encoded);
}

export function defaultSessionPath(cwd: string, paths?: AlphaPaths): string {
  return join(projectSessionDir(cwd, paths), "default.jsonl");
}
