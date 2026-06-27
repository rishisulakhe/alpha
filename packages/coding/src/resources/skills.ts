import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  name: string;
  description: string;
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; content: string } {
  const lines = raw.split("\n");
  const frontmatter: Record<string, string> = {};

  if (lines[0]?.trim() === "---") {
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        endIdx = i;
        break;
      }
      const match = lines[i]?.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
      if (match) {
        frontmatter[match[1]!] = (match[2] ?? "").trim();
      }
    }
    if (endIdx > 0) {
      return { frontmatter, content: lines.slice(endIdx + 1).join("\n").trim() };
    }
  }

  return { frontmatter, content: raw.trim() };
}

// ---------------------------------------------------------------------------
// loadSkills
// ---------------------------------------------------------------------------

export function loadSkills(paths: string[]): Skill[] {
  const nameMap = new Map<string, Skill>();

  for (const dir of paths) {
    if (!existsSync(dir)) continue;

    _loadDir(dir, nameMap, Infinity);
  }

  return [...nameMap.values()];
}

function _loadDir(dir: string, nameMap: Map<string, Skill>, priority: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      const skillFile = join(fullPath, "SKILL.md");
      if (existsSync(skillFile)) {
        const skill = _loadSkillFile(skillFile, priority);
        if (skill) _addSkill(nameMap, skill, priority);
      }
    } else if (stat.isFile() && extname(entry) === ".md") {
      const skill = _loadSkillFile(fullPath, priority);
      if (skill) _addSkill(nameMap, skill, priority);
    }
  }
}

function _loadSkillFile(filePath: string, priority: number): Skill | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const { frontmatter, content } = parseFrontmatter(raw);
  const name = frontmatter.name ?? basename(filePath, ".md");

  // Skip SKILL.md files with disableModelInvocation
  if (basename(filePath) === "SKILL.md" && frontmatter.disableModelInvocation === "true") {
    return null;
  }

  return {
    name,
    description: frontmatter.description ?? `Skill from ${filePath}`,
    content,
    path: filePath,
  };
}

function _addSkill(nameMap: Map<string, Skill>, skill: Skill, priority: number): void {
  const existing = nameMap.get(skill.name);
  if (!existing || _getPriority(existing) <= priority) {
    nameMap.set(skill.name, skill);
    // Store priority in a weak way — use a side map or just replace
  }
}

// We don't actually track priority per skill since we load in order.
// Higher priority dirs are loaded last, so they naturally override.
// The existing logic already handles this since we just set().

// ---------------------------------------------------------------------------
// expandSkillInvocation
// ---------------------------------------------------------------------------

export function expandSkillInvocation(text: string, skills: Skill[]): string | null {
  const match = text.match(/^\/skill:(\S+)\s*(.*)$/s);
  if (!match) return null;

  const skillName = match[1]!;
  const additionalInstructions = (match[2] ?? "").trim();

  const skill = skills.find((s) => s.name === skillName);
  if (!skill) return null;

  const escapedName = _escapeXml(skill.name);
  const escapedPath = _escapeXml(skill.path);
  const escapedContent = skill.content; // Keep markdown raw

  let result = `<skill name="${escapedName}" location="${escapedPath}">\n${escapedContent}\n</skill>`;

  if (additionalInstructions) {
    result += `\n\n${additionalInstructions}`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// formatSkillsForSystemPrompt
// ---------------------------------------------------------------------------

export function formatSkillsForSystemPrompt(
  skills: Skill[],
  hasReadTool: boolean,
): string {
  if (!hasReadTool || skills.length === 0) return "";

  const lines: string[] = ["<available_skills>"];

  for (const skill of skills) {
    lines.push("<skill>");
    lines.push(`<name>${_escapeXml(skill.name)}</name>`);
    lines.push(`<description>${_escapeXml(skill.description)}</description>`);
    lines.push(`<location>${_escapeXml(skill.path)}</location>`);
    lines.push("</skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function _getPriority(skill: Skill): number {
  // Priority is encoded in the loading order — first loaded = lowest priority
  // We don't store it, just return 0 for the fallback
  return 0;
}
